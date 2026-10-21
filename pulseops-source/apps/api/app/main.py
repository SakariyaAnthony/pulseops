from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import alerts, auth, endpoints, errors, health, ingest, insights, metrics, overview, projects, resources, scans, services, vitals, ws


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.scan.worker import recover_interrupted, start_worker

    recover_interrupted()
    start_worker()
    yield


app = FastAPI(title="PulseOps API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(scans.router)
app.include_router(overview.router)
app.include_router(metrics.router)
app.include_router(services.router)
app.include_router(endpoints.router)
app.include_router(resources.router)
app.include_router(errors.router)
app.include_router(insights.router)
app.include_router(alerts.router)
app.include_router(vitals.router)
app.include_router(ingest.router)
app.include_router(ws.router)
