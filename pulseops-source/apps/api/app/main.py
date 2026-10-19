from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import alerts, auth, endpoints, errors, health, ingest, metrics, overview, projects, resources, services, ws

app = FastAPI(title="PulseOps API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(overview.router)
app.include_router(metrics.router)
app.include_router(services.router)
app.include_router(endpoints.router)
app.include_router(resources.router)
app.include_router(errors.router)
app.include_router(alerts.router)
app.include_router(ingest.router)
app.include_router(ws.router)
