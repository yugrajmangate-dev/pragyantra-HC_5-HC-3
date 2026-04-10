from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
resp = client.get("/history?page=1&page_size=1", headers={"Origin": "http://127.0.0.1:3000"})
print("Status:", resp.status_code)
print("ACAO:", resp.headers.get("access-control-allow-origin"))
print("Content:\n", resp.text[:500])
