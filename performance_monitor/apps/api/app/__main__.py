import uvicorn

from app.config import settings


def main() -> None:
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.api_port)


if __name__ == "__main__":
    main()
