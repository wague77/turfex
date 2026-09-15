import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv

load_dotenv()
mongo_url = os.environ.get('MONGO_URL')
db_name = os.environ.get('DB_NAME')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

async def main():
    # Let's insert or update the access code BDBX-BGEY-C3KW
    res = await db.odds_users.update_one(
        {'code': 'BDBX-BGEY-C3KW'},
        {'$set': {'username': 'Client VIP', 'expiration': '2099-12-31T23:59:59Z'}},
        upsert=True
    )
    print(f"Update result: {res.modified_count} modified, {res.upserted_id} upserted.")

asyncio.run(main())
