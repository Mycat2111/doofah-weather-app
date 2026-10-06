# The forecast pipeline as one image (plan: Cloud Run Jobs, started by Cloud Scheduler).
#   docker build -t doofah-pipeline pipeline
#   docker run --rm -e DATABASE_URL doofah-pipeline ingest ecmwf_hres
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY README.md ./
COPY src ./src
RUN uv sync --locked --no-dev

ENV PATH="/app/.venv/bin:$PATH"
USER nobody
ENTRYPOINT ["python", "-m", "doofah_pipeline"]
CMD ["ingest", "ecmwf_hres"]
