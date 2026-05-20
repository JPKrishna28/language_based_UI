import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_options():
    response = supabase.table("prs_options").select("*").execute()
    return response.data


if __name__ == "__main__":
    options = fetch_options()
    print(f"Fetched {len(options)} options")
    for opt in options[:5]:
        print(opt)
