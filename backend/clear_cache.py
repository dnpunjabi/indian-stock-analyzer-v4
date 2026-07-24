import sqlite3
import glob
import os

backend_dir = os.path.dirname(__file__)
db_files = glob.glob(os.path.join(backend_dir, "*.db"))

for db_file in db_files:
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cached_profiles'")
        if cursor.fetchone():
            cursor.execute("DELETE FROM cached_profiles WHERE symbol LIKE '%POLYCAB%'")
            conn.commit()
            print(f"Cleared stale POLYCAB profile from {os.path.basename(db_file)}")
        conn.close()
    except Exception as e:
        print(f"Error checking {db_file}: {e}")
