"""
Provider-Agnostic LLM Configuration Module
==========================================
Unified abstraction layer for routing LLM calls to different models/providers.
Configuration is dynamically loaded from environment variables on every call to support hot-swapping.
"""

import os
from dotenv import load_dotenv

# Task-type constants for hybrid routing
TASK_HEAVY = "heavy"   # CFA Fundamentals, CIO Synthesis, Portfolio Doctor
TASK_FAST  = "fast"    # Co-Pilot Chat, Sentiment, Technical, News synthesis

def _get_config():
    """Dynamically load and return configuration from environment variables."""
    from dotenv import load_dotenv
    load_dotenv(override=True)
    
    provider = os.environ.get("LLM_PROVIDER", "groq").lower()
    base_url = os.environ.get("LLM_BASE_URL", "")
    api_key = os.environ.get("LLM_API_KEY", "") or os.environ.get("GROQ_API_KEY", "")
    
    heavy_model = os.environ.get("LLM_HEAVY_MODEL", "llama-3.3-70b-versatile")
    fast_model = os.environ.get("LLM_FAST_MODEL", "llama-3.3-70b-versatile")
    
    heavy_label = os.environ.get("LLM_HEAVY_LABEL", "Groq Llama 3.3 70B")
    fast_label = os.environ.get("LLM_FAST_LABEL", "Groq Llama 3.3 70B")
    
    temperature = float(os.environ.get("LLM_TEMPERATURE", "0.2"))
    
    return {
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "heavy_model": heavy_model,
        "fast_model": fast_model,
        "heavy_label": heavy_label,
        "fast_label": fast_label,
        "temperature": temperature
    }

# Client cache references
_cached_client = None
_cached_key = None
_cached_provider = None
_cached_base_url = None

def _get_client(config=None):
    """Return appropriate client, recreating it dynamically if config changes."""
    global _cached_client, _cached_key, _cached_provider, _cached_base_url
    if config is None:
        config = _get_config()
        
    api_key = config["api_key"]
    provider = config["provider"]
    base_url = config["base_url"]
    
    # Recreate client if configuration has changed
    if (_cached_client is None or 
        _cached_key != api_key or 
        _cached_provider != provider or 
        _cached_base_url != base_url):
        
        _cached_client = None
        _cached_key = api_key
        _cached_provider = provider
        _cached_base_url = base_url
        
        try:
            if provider == "groq":
                from groq import Groq
                _cached_client = Groq(api_key=api_key) if api_key else Groq()
                print("[LLM Config] Reinitialized Groq client dynamically.")
            else:
                from openai import OpenAI
                if base_url:
                    _cached_client = OpenAI(api_key=api_key, base_url=base_url)
                else:
                    _cached_client = OpenAI(api_key=api_key)
                print(f"[LLM Config] Reinitialized OpenAI client dynamically (base_url={base_url}).")
        except Exception as e:
            print(f"[LLM Config] Error dynamically initializing client: {e}")
            _cached_client = None
            
    return _cached_client

def call_llm(task_type: str,
             system_prompt: str,
             user_prompt: str = None,
             max_tokens: int = 2500,
             messages: list = None) -> str:
    """
    Provider-agnostic LLM call. Routes to the correct model based on task_type.
    """
    config = _get_config()
    client = _get_client(config)
    if client is None:
        return "ERROR_401: LLM client is not initialized. Please verify your API key and LLM_PROVIDER settings."

    model = config["heavy_model"] if task_type == TASK_HEAVY else config["fast_model"]
    label = config["heavy_label"] if task_type == TASK_HEAVY else config["fast_label"]
    temperature = config["temperature"]

    # Ensure system prompt suppresses thinking process/chain-of-thought metadata
    suppress_instructions = (
        "\n\nIMPORTANT CONSTRUCT LIMITS:\n"
        "1. Do NOT output any chain of thought, thinking process, planning steps, or self-correction commentary (such as 'Here's a thinking process' or 'Analyzing inputs').\n"
        "2. Do NOT include any introductory greetings, meta-explanations, or conversational filler.\n"
        "3. Start your response directly with the requested output (HTML, markdown, JSON, or paragraphs) in its final formatted state."
    )

    # Build messages if not pre-built
    if messages is None:
        messages = [
            {"role": "system", "content": system_prompt + suppress_instructions},
        ]
        if user_prompt:
            messages.append({"role": "user", "content": user_prompt})
    else:
        # If pre-built messages are provided, inject the suppression into the system message
        for msg in messages:
            if msg.get("role") == "system":
                msg["content"] = msg["content"] + suppress_instructions
                break

    # Prevent token truncation: scale max_tokens up to allow headroom for thinking logs
    safe_max_tokens = min(4096, max(max_tokens, 2000))

    try:
        print(f"[LLM] Calling {label} (model: {model}, task: {task_type}, tokens: {safe_max_tokens})...")
        chat_completion = client.chat.completions.create(
            messages=messages,
            model=model,
            max_tokens=safe_max_tokens,
            temperature=temperature
        )
        response_content = chat_completion.choices[0].message.content
        print(f"[LLM] Successfully received response from {label} ({len(response_content)} chars)")
        return _clean_reasoning_metadata(response_content)
    except Exception as e:
        print(f"[LLM] Error calling {label}: {e}")
        err_msg = str(e)
        if "invalid_api_key" in err_msg or "401" in err_msg or "Invalid API Key" in err_msg:
            return "ERROR_401: Invalid API Key. Activating local high-fidelity fallback reasoning."

        # Fallback: try the other model if the primary fails
        fallback_model = config["fast_model"] if task_type == TASK_HEAVY else config["heavy_model"]
        if fallback_model != model:
            try:
                print(f"[LLM] Retrying with fallback model: {fallback_model}...")
                chat_completion = client.chat.completions.create(
                    messages=messages,
                    model=fallback_model,
                    max_tokens=safe_max_tokens,
                    temperature=temperature
                )
                return _clean_reasoning_metadata(chat_completion.choices[0].message.content)
            except Exception as e2:
                if "invalid_api_key" in str(e2) or "401" in str(e2):
                    return "ERROR_401: Invalid API Key. Activating local high-fidelity fallback reasoning."
                return f"ERROR: Failed to query LLM. Details: {str(e2)}"
        
        return f"ERROR: Failed to query LLM model {model}. Details: {err_msg}"

def _clean_reasoning_metadata(text: str) -> str:
    """Strip out any internal thinking process, chain-of-thought blocks, or conversational greetings from the text."""
    if not text:
        return text
        
    lower_text = text.lower()
    
    # Check if the text starts with a thinking indicator
    starts_with_thinking = any(lower_text.strip().startswith(p) for p in [
        "thinking process", "reasoning process", "analysis process", 
        "here's a thinking process", "here is the thinking process",
        "here is a thinking process", "here's the thinking process"
    ])
    
    import re
    
    # Always strip standard <think>...</think> reasoning blocks if present (e.g. DeepSeek-R1)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    if not starts_with_thinking:
        return text.strip()
        
    # 1. Look for the last "Draft:" or "Response:" or "Output:" marker
    # We match variations like "Draft (Mental Refinement):" or "Draft:"
    markers = [
        r'\b(?:draft|response|answer|output)\s*(?:\([^)]*\))?\s*[:\*\s]*'
    ]
    last_idx = -1
    last_end = -1
    for marker in markers:
        for m in re.finditer(marker, lower_text):
            if m.start() > last_idx:
                last_idx = m.start()
                last_end = m.end()
                
    # If a draft marker was found, return everything after it
    if last_idx != -1:
        return text[last_end:].strip()
        
    # 2. If no explicit draft marker was found, look for the last <h4> or <h3> or ## tag 
    # that has a trailing body (meaning it is not at the very end of the text)
    headers = [r'<h[1-6]>', r'^###\s', r'^##\s', r'^####\s']
    last_header_idx = -1
    for header in headers:
        # Match multiline header starts
        flags = re.MULTILINE | re.IGNORECASE
        for m in re.finditer(header, text, flags=flags):
            # Check if this header is NOT just in the first 200 characters (where rules outlines are)
            if m.start() > 200 and m.start() < len(text) - 50:
                if m.start() > last_header_idx:
                    last_header_idx = m.start()
                    
    if last_header_idx != -1:
        return text[last_header_idx:].strip()
        
    return text.strip()

# ---------------------------------------------------------------------------
# Status & Configuration API (consumed by frontend via /api/llm-config)
# ---------------------------------------------------------------------------
def is_llm_available() -> bool:
    """Check whether a valid LLM client can be initialized."""
    return _get_client() is not None

def get_llm_config() -> dict:
    """Return active LLM configuration for the frontend API endpoint."""
    config = _get_config()
    available = is_llm_available()
    return {
        "provider": config["provider"],
        "heavy_model": config["heavy_model"],
        "fast_model": config["fast_model"],
        "heavy_label": config["heavy_label"],
        "fast_label": config["fast_label"],
        "status": "connected" if available else "disconnected",
        "base_url": config["base_url"] or "(default provider endpoint)",
    }
