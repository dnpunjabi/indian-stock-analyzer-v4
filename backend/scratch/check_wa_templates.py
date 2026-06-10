import requests, os, json
from dotenv import load_dotenv
load_dotenv()

token = os.environ.get('WHATSAPP_TOKEN', '')
phone_id = os.environ.get('WHATSAPP_PHONE_ID', '')
recipient = os.environ.get('WHATSAPP_RECIPIENT', '')

# First, get the WABA ID from the phone number
url = f'https://graph.facebook.com/v21.0/{phone_id}'
headers = {'Authorization': f'Bearer {token}'}
resp = requests.get(url, headers=headers, timeout=15)
print(f'Phone number info status: {resp.status_code}')
phone_data = resp.json()
print(f'Phone data: {json.dumps(phone_data, indent=2)}')

# Try sending using hello_world template (pre-approved for all accounts)
print("\n--- Sending hello_world template message ---")
url2 = f'https://graph.facebook.com/v21.0/{phone_id}/messages'
headers2 = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
payload = {
    "messaging_product": "whatsapp",
    "to": recipient,
    "type": "template",
    "template": {
        "name": "hello_world",
        "language": {
            "code": "en_US"
        }
    }
}
resp2 = requests.post(url2, headers=headers2, json=payload, timeout=15)
print(f'Template send status: {resp2.status_code}')
print(f'Template response: {resp2.text}')
