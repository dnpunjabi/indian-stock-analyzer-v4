import sys
import os
import traceback

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.financial_utils import get_complete_financial_profile

if __name__ == "__main__":
    print("Testing get_complete_financial_profile with GVT&D...")
    try:
        profile = get_complete_financial_profile("GVT&D")
        print("Success! Keys in profile:", list(profile.keys()))
    except Exception as e:
        print("Failed with exception:")
        print(e)
        traceback.print_exc()
