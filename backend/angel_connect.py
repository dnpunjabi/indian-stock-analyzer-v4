"""
Angel One SmartAPI Connector Module
====================================
Handles authentication (TOTP-based), instrument master token mapping,
and provides the bridge between plain stock symbols and Angel One's
SmartWebSocketV2 token system.

This module is a singleton — initialized once at FastAPI startup and shared
across the WebSocket server, Alert Engine, and REST endpoints.
"""

import os
import json
import time
import threading
import logging
import requests as http_requests
import pyotp
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("angel_connect")

# Try importing SmartConnect; gracefully handle if not installed
try:
    from SmartApi import SmartConnect
    SMARTAPI_AVAILABLE = True
except ImportError:
    SMARTAPI_AVAILABLE = False
    logger.warning("smartapi-python not installed. Angel One features will be unavailable.")


class AngelOneConnector:
    """
    Manages Angel One SmartAPI authentication, session lifecycle,
    and instrument token resolution.
    """

    INSTRUMENT_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"

    def __init__(self, api_key: str, client_code: str, password: str, totp_key: str):
        self.api_key = api_key
        self.client_code = client_code
        self.password = password
        self.totp_key = totp_key

        # Session state
        self.smart_connect: Optional[Any] = None
        self.auth_token: Optional[str] = None
        self.feed_token: Optional[str] = None
        self._authenticated = False
        self._auth_time: float = 0.0

        # Instrument master: symbol → {token, exch_seg, name, ...}
        self._instrument_map: Dict[str, Dict[str, str]] = {}
        self._instrument_loaded = False
        self._instrument_lock = threading.Lock()

        # Reverse map: token → symbol (for decoding WebSocket ticks)
        self._token_to_symbol: Dict[str, str] = {}

    # ────────────────────────── Authentication ──────────────────────────

    def authenticate(self) -> bool:
        """
        Initializes an Angel One session using dynamic TOTP.
        Returns True if authentication succeeded.
        """
        if not SMARTAPI_AVAILABLE:
            logger.error("Cannot authenticate: smartapi-python is not installed.")
            return False

        for attempt in range(2):  # Auto-retry once
            try:
                totp_code = pyotp.TOTP(self.totp_key).now()
                self.smart_connect = SmartConnect(api_key=self.api_key)

                session = self.smart_connect.generateSession(
                    self.client_code, self.password, totp_code
                )

                if session and session.get("status"):
                    data = session.get("data", {})
                    self.auth_token = data.get("jwtToken")
                    self.feed_token = self.smart_connect.getfeedToken()
                    self._authenticated = True
                    self._auth_time = time.time()
                    logger.info(
                        "Angel One authentication successful. "
                        f"Client: {self.client_code}, Feed token acquired."
                    )
                    return True
                else:
                    msg = session.get("message", "Unknown error") if session else "No response"
                    logger.warning(
                        f"Angel One auth attempt {attempt + 1} failed: {msg}"
                    )
                    if attempt == 0:
                        time.sleep(2)  # Brief pause before retry (TOTP window)
            except Exception as e:
                logger.error(f"Angel One auth attempt {attempt + 1} exception: {e}")
                if attempt == 0:
                    time.sleep(2)

        self._authenticated = False
        return False

    def re_authenticate(self) -> bool:
        """Re-authenticates if session is stale (>20 hours old)."""
        logger.info("Re-authenticating Angel One session...")
        return self.authenticate()

    def is_authenticated(self) -> bool:
        """Returns True if authenticated and session is less than 20 hours old."""
        if not self._authenticated:
            return False
        elapsed = time.time() - self._auth_time
        if elapsed > 72000:  # 20 hours
            logger.warning("Angel One session expired (>20h). Re-authentication required.")
            self._authenticated = False
            return False
        return True

    # ────────────────────── Instrument Master ──────────────────────────

    def load_instrument_master(self) -> int:
        """
        Downloads and parses the Angel One Instrument Master JSON.
        Builds an in-memory lookup: plain symbol → {token, exch_seg, name, ...}

        Returns the number of NSE equity instruments loaded.
        """
        logger.info("Downloading Angel One Instrument Master (~25 MB)...")
        try:
            resp = http_requests.get(self.INSTRUMENT_MASTER_URL, timeout=60)
            resp.raise_for_status()
            instruments = resp.json()
        except Exception as e:
            logger.error(f"Failed to download instrument master: {e}")
            return 0

        with self._instrument_lock:
            self._instrument_map.clear()
            self._token_to_symbol.clear()
            nse_eq_count = 0

            for inst in instruments:
                token = inst.get("token", "")
                symbol = inst.get("symbol", "")
                exch_seg = inst.get("exch_seg", "")
                name = inst.get("name", "")
                instrument_type = inst.get("instrumenttype", "")

                if not token or not symbol:
                    continue

                # We prioritize NSE Cash Market equities (EQ segment)
                # Symbol format in master: "TCS-EQ", "RELIANCE-EQ", etc.
                if exch_seg.upper() == "NSE" and symbol.endswith("-EQ"):
                    plain_symbol = symbol.replace("-EQ", "")
                    self._instrument_map[plain_symbol] = {
                        "token": token,
                        "exch_seg": exch_seg,
                        "symbol": symbol,
                        "name": name,
                        "instrument_type": instrument_type,
                    }
                    self._token_to_symbol[token] = plain_symbol
                    nse_eq_count += 1

                # Also index BSE equity for fallback
                elif exch_seg.upper() == "BSE" and instrument_type == "":
                    plain_symbol = symbol
                    # Only add if not already mapped via NSE
                    bse_key = f"BSE:{plain_symbol}"
                    self._instrument_map[bse_key] = {
                        "token": token,
                        "exch_seg": exch_seg,
                        "symbol": symbol,
                        "name": name,
                        "instrument_type": instrument_type,
                    }

            self._instrument_loaded = True
            logger.info(
                f"Instrument master loaded: {nse_eq_count} NSE equities, "
                f"{len(self._instrument_map)} total entries."
            )
            return nse_eq_count

    def resolve_token(self, symbol: str) -> Optional[Tuple[str, int]]:
        """
        Resolves a plain symbol (e.g. 'TCS', 'RELIANCE') to an Angel One
        instrument token and exchange type integer.

        Returns (token_str, exchange_type_int) or None if not found.
        Exchange types: 1=NSE_CM, 2=NSE_FO, 3=BSE_CM, 5=MCX_FO
        """
        if not self._instrument_loaded:
            logger.warning("Instrument master not loaded. Cannot resolve token.")
            return None

        plain = symbol.strip().upper()
        # Remove .NS suffix if present
        if plain.endswith(".NS"):
            plain = plain[:-3]

        with self._instrument_lock:
            entry = self._instrument_map.get(plain)
            if entry:
                exchange_type = 1  # NSE_CM
                if entry["exch_seg"].upper() == "BSE":
                    exchange_type = 3  # BSE_CM
                return (entry["token"], exchange_type)

        return None

    def resolve_tokens_batch(self, symbols: list) -> list:
        """
        Resolves a list of symbols to Angel One subscription format.
        Returns list of {"exchangeType": int, "tokens": [str, ...]} dicts
        grouped by exchange type.
        """
        nse_tokens = []
        bse_tokens = []

        for sym in symbols:
            result = self.resolve_token(sym)
            if result:
                token, exch_type = result
                if exch_type == 1:
                    nse_tokens.append(token)
                elif exch_type == 3:
                    bse_tokens.append(token)

        token_list = []
        if nse_tokens:
            token_list.append({"exchangeType": 1, "tokens": nse_tokens})
        if bse_tokens:
            token_list.append({"exchangeType": 3, "tokens": bse_tokens})

        return token_list

    def token_to_symbol(self, token: str) -> Optional[str]:
        """Reverse lookup: Angel One token → plain symbol."""
        return self._token_to_symbol.get(token)

    # ────────────────────── REST Fallback (LTP) ──────────────────────────

    def get_live_ltp(self, symbol: str, exchange: str = "NSE") -> Optional[Dict[str, Any]]:
        """
        REST API fallback: fetches LTP for a single symbol via SmartConnect.
        Use this when WebSocket is unavailable.
        """
        if not self.is_authenticated():
            if not self.re_authenticate():
                return None

        result = self.resolve_token(symbol)
        if not result:
            return None

        token, _ = result
        try:
            quote = self.smart_connect.ltpData(exchange, symbol, token)
            if quote and quote.get("status"):
                data = quote.get("data", {})
                return {
                    "price": data.get("ltp", 0.0),
                    "exchange": exchange,
                    "token": token,
                    "symbol": symbol,
                }
        except Exception as e:
            logger.error(f"LTP REST query failed for {symbol}: {e}")

        return None

    # ────────────────────── Status ──────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Returns current connection/session status for the /api/angel/status endpoint."""
        return {
            "available": SMARTAPI_AVAILABLE,
            "authenticated": self._authenticated,
            "session_age_minutes": round((time.time() - self._auth_time) / 60, 1) if self._auth_time else 0,
            "instrument_master_loaded": self._instrument_loaded,
            "instrument_count": len(self._instrument_map),
            "client_code": self.client_code[:3] + "***" if self.client_code else None,
        }
