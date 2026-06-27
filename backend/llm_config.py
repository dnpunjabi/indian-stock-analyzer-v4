"""
Provider-Agnostic LLM Configuration Module
==========================================
Unified abstraction layer for routing LLM calls to different models/providers.

Supports:
- Groq (native SDK)
- Any OpenAI-compatible API (Together AI, OpenRouter, Ollama, vLLM, etc.)

Configuration is driven entirely by environment variables (.env file).
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Task-type constants for hybrid routing
# ---------------------------------------------------------------------------
TASK_HEAVY = "heavy"   # CFA Fundamentals, CIO Synthesis, Portfolio Doctor
TASK_FAST  = "fast"    # Co-Pilot Chat, Sentiment, Technical, News synthesis

# ---------------------------------------------------------------------------
# Environment-driven configuration
# ---------------------------------------------------------------------------
LLM_PROVIDER   = os.environ.get("LLM_PROVIDER", "groq").lower()
LLM_BASE_URL   = os.environ.get("LLM_BASE_URL", "")
LLM_API_KEY    = os.environ.get("LLM_API_KEY", "") or os.environ.get("GROQ_API_KEY", "")

# Model identifiers (provider-specific model strings)
LLM_HEAVY_MODEL = os.environ.get("LLM_HEAVY_MODEL", "llama-3.3-70b-versatile")
LLM_FAST_MODEL  = os.environ.get("LLM_FAST_MODEL", "llama-3.3-70b-versatile")

# Human-readable display labels for the frontend
LLM_HEAVY_LABEL = os.environ.get("LLM_HEAVY_LABEL", "Groq Llama 3.3 70B")
LLM_FAST_LABEL  = os.environ.get("LLM_FAST_LABEL", "Groq Llama 3.3 70B")

# Generation defaults
LLM_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.2"))

# ---------------------------------------------------------------------------
# Client initialization
# ---------------------------------------------------------------------------
_groq_client = None
_openai_client = None

def _init_groq_client():
    """Initialize the Groq native SDK client."""
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    try:
        from groq import Groq
        _groq_client = Groq(api_key=LLM_API_KEY) if LLM_API_KEY else Groq()
        print(f"[LLM Config] Groq client initialized successfully.")
        return _groq_client
    except Exception as e:
        print(f"[LLM Config] Failed to initialize Groq client: {e}")
        return None

def _init_openai_client():
    """Initialize an OpenAI-compatible client (works with Together AI, OpenRouter, Ollama, etc.)."""
    global _openai_client
    if _openai_client is not None:
        return _openai_client
    try:
        from openai import OpenAI
        if not LLM_BASE_URL:
            print("[LLM Config] WARNING: LLM_BASE_URL is not set for openai_compat provider.")
            return None
        _openai_client = OpenAI(
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
        )
        print(f"[LLM Config] OpenAI-compatible client initialized (base_url={LLM_BASE_URL}).")
        return _openai_client
    except Exception as e:
        print(f"[LLM Config] Failed to initialize OpenAI-compatible client: {e}")
        return None


def _get_client():
    """Return the appropriate client based on configured provider."""
    if LLM_PROVIDER == "groq":
        return _init_groq_client()
    elif LLM_PROVIDER in ("openai_compat", "openai", "together", "openrouter", "ollama", "vllm"):
        return _init_openai_client()
    else:
        # Default: try Groq first, then OpenAI-compat
        client = _init_groq_client()
        if client is None:
            client = _init_openai_client()
        return client


# ---------------------------------------------------------------------------
# Unified LLM call interface
# ---------------------------------------------------------------------------
def call_llm(task_type: str,
             system_prompt: str,
             user_prompt: str = None,
             max_tokens: int = 2500,
             messages: list = None) -> str:
    """
    Provider-agnostic LLM call. Routes to the correct model based on task_type.
    
    Args:
        task_type: TASK_HEAVY or TASK_FAST — determines which model to use.
        system_prompt: The system instruction.
        user_prompt: The user message (optional if messages is provided).
        max_tokens: Maximum tokens for the response.
        messages: Pre-built message list (overrides system_prompt/user_prompt if provided).
    
    Returns:
        The LLM response text, or an error string prefixed with "ERROR".
    """
    client = _get_client()
    if client is None:
        return "ERROR_401: LLM client is not initialized. Please verify your API key and LLM_PROVIDER settings."

    # Select model based on task type
    model = LLM_HEAVY_MODEL if task_type == TASK_HEAVY else LLM_FAST_MODEL
    label = LLM_HEAVY_LABEL if task_type == TASK_HEAVY else LLM_FAST_LABEL

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

    try:
        print(f"[LLM] Calling {label} (model: {model}, task: {task_type}, tokens: {max_tokens})...")
        chat_completion = client.chat.completions.create(
            messages=messages,
            model=model,
            max_tokens=max_tokens,
            temperature=LLM_TEMPERATURE
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
        fallback_model = LLM_FAST_MODEL if task_type == TASK_HEAVY else LLM_HEAVY_MODEL
        if fallback_model != model:
            try:
                print(f"[LLM] Retrying with fallback model: {fallback_model}...")
                chat_completion = client.chat.completions.create(
                    messages=messages,
                    model=fallback_model,
                    max_tokens=max_tokens,
                    temperature=LLM_TEMPERATURE
                )
                return _clean_reasoning_metadata(chat_completion.choices[0].message.content)
            except Exception as e2:
                if "invalid_api_key" in str(e2) or "401" in str(e2):
                    return "ERROR_401: Invalid API Key. Activating local high-fidelity fallback reasoning."
                return f"ERROR: Failed to query LLM. Details: {str(e2)}"
        
        return f"ERROR: Failed to query LLM model {model}. Details: {err_msg}"

def _clean_reasoning_metadata(text: str) -> str:
    """Strip out any internal thinking process, chain-of-thought blocks, or conversational greetings from the text."""
    import re
    if not text:
        return text
    
    # 1. Strip standard <think>...</think> reasoning blocks if present (e.g. DeepSeek-R1)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    # 2. Strip "Thinking Process: ... Draft: " (using negative lookahead to strip up to the final Draft/Response tag)
    text = re.sub(
        r'^\s*(?:Thinking\s+Process|Reasoning\s+Process|Analysis\s+Process|Here\'s\s+a\s+thinking\s+process|Here\s+is\s+the\s+thinking\s+process):.*?(?:\*Draft:\*|Draft:|Response:|Answer:|Output:)(?!.*\b(?:Draft|Response|Answer|Output)\b)\s*',
        '',
        text,
        flags=re.DOTALL | re.IGNORECASE
    )

    # 3. Strip any residual planning outlines or reasoning logs at the beginning of the text
    text = re.sub(r'^\s*(?:thinking\s+process|reasoning\s+process|analysis\s+process|planning\s+process):.*?(?=\n\n|\n[A-Z#<])', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    return text.strip()


# ---------------------------------------------------------------------------
# Status & Configuration API (consumed by frontend via /api/llm-config)
# ---------------------------------------------------------------------------
def is_llm_available() -> bool:
    """Check whether a valid LLM client can be initialized."""
    return _get_client() is not None


def get_llm_config() -> dict:
    """Return active LLM configuration for the frontend API endpoint."""
    available = is_llm_available()
    return {
        "provider": LLM_PROVIDER,
        "heavy_model": LLM_HEAVY_MODEL,
        "fast_model": LLM_FAST_MODEL,
        "heavy_label": LLM_HEAVY_LABEL,
        "fast_label": LLM_FAST_LABEL,
        "status": "connected" if available else "disconnected",
        "base_url": LLM_BASE_URL or "(default provider endpoint)",
    }
