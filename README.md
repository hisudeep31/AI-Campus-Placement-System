# AI-Powered Campus Placement Management System

A web-based placement platform with student, company, placement-officer and admin roles. It includes job management, applications, resume parsing/ATS scoring, skill matching and AI-assisted placement features.

## Software required

- **Docker Desktop** (with Docker Compose) – runs PostgreSQL, the Node.js API and the Python AI service.
- **Node.js 20 or later** and npm – runs the React frontend.
- A modern web browser.

> Internet access is required the first time Docker builds the images and installs dependencies. After the images and packages are available locally, normal startup can run offline.

## Run the project (Windows)

1. Install and open Docker Desktop.
2. Extract the project ZIP and open PowerShell in the `placement-system` folder (the folder containing `docker-compose.yml`).
3. Start the database, backend API and AI service:

   ```bash
   docker compose up --build -d
   ```

4. Open a second PowerShell window, go to the frontend folder and install its packages:

   ```bash
   cd client
   npm install
   npm run dev
   ```

5. Open the frontend in your browser:

   **http://localhost:5173**

## Service URLs

- Frontend: http://localhost:5173
- Backend API health check: http://localhost:5000/health
- AI service health check: http://localhost:8000/health
- PostgreSQL: `localhost:5432` (database: `placement_db`)

## Default administrator account

The Docker Compose configuration seeds this local administrator account:

- Email: `admin@example.com`
- Password: `Admin123!`

Change the default credentials and secrets before deploying the application outside a local/demo environment.

## Stop the project

Stop the containers while keeping database data:

```bash
docker compose down
```

To also delete the PostgreSQL data volume and reset the local database (this permanently deletes its stored data):

```bash
docker compose down -v
```

## Notes

- Run Docker commands from the project root, where `docker-compose.yml` is located.
- The first startup can take several minutes while Docker downloads images and installs dependencies.
- Do not commit `.env` files, passwords, API keys or uploaded private resumes to a public repository.
