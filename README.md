# safarsetubackend-18-10-26

SafarSetu Cab Booking Platform — Backend API Service.

## Tech Stack
- **Node.js & Express**
- **Prisma ORM** with Cloud MySQL
- **Socket.io** (Realtime GPS tracking, ride updates & driver notifications)
- **JWT Authentication**

## Deployment on Render
- **Runtime**: Node
- **Build Command**: `npm install && npx prisma generate`
- **Start Command**: `npm start`

### Required Environment Variables
- `DATABASE_URL`: Cloud MySQL connection string
- `JWT_SECRET`: Secret key for signing authentication tokens
- `CORS_ORIGIN`: Allowed origin (e.g. `*` or frontend domain)
- `PORT`: 4000
