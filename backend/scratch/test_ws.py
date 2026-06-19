import os
import sys
import time
from dotenv import load_dotenv
load_dotenv()

# Add parent dir to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.angel_connect import AngelOneConnector
from SmartApi.smartWebSocketV2 import SmartWebSocketV2

api_key = os.environ.get("ANGEL_API_KEY", "")
client_code = os.environ.get("ANGEL_CLIENT_CODE", "")
password = os.environ.get("ANGEL_PASSWORD", "")
totp_key = os.environ.get("ANGEL_TOTP_KEY", "")

print("Credentials:")
print("API_KEY:", api_key)
print("CLIENT_CODE:", client_code)
print("PASSWORD:", password)
print("TOTP_KEY:", totp_key)

connector = AngelOneConnector(
    api_key=api_key,
    client_code=client_code,
    password=password,
    totp_key=totp_key,
)

print("Authenticating...")
if not connector.authenticate():
    print("Authentication failed!")
    sys.exit(1)

print("Authentication successful!")
print("Auth Token:", connector.auth_token)
print("Feed Token:", connector.feed_token)

print("Loading instruments...")
connector.load_instrument_master()

# Resolve token for SBIN (State Bank of India)
resolved = connector.resolve_token("SBIN")
print("Resolved SBIN:", resolved)
if not resolved:
    print("Could not resolve SBIN token!")
    sys.exit(1)

token, exch = resolved

sws = SmartWebSocketV2(
    connector.auth_token,
    connector.api_key,
    connector.client_code,
    connector.feed_token,
)

def on_data(wsapp, message):
    print("RAW MESSAGE RECEIVED:", message)

def on_open(wsapp):
    print("WEBSOCKET CONNECTED!")
    token_list = [{"exchangeType": exch, "tokens": [token]}]
    print("Subscribing to:", token_list)
    sws.subscribe("apex_live_feed", mode=2, token_list=token_list)

def on_error(wsapp, error):
    print("WEBSOCKET ERROR:", error)

def on_close(wsapp, close_status_code=None, close_msg=None):
    print("WEBSOCKET CLOSED:", close_status_code, close_msg)

sws.on_open = on_open
sws.on_data = on_data
sws.on_error = on_error
sws.on_close = on_close

print("Connecting WebSocket...")
sws.connect()

# Sleep for 15 seconds to receive ticks
time.sleep(15)
print("Closing connection...")
sws.close_connection()
