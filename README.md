# EZ Gym Dashboard

Gym CRM + scheduling dashboard, built from scratch with:
- Node.js + Express backend
- MongoDB Atlas via Mongoose
- SQLite migration support for existing local data (`data/gym.sqlite`)
- Vanilla HTML/CSS/JS frontend SPA
- JWT auth
- `dayjs` date handling

## Features

- Authentication and role-based users
- Dashboard KPIs (payments, expenses, net, bookings, branch summary)
- Clients CRUD and detailed profile view
- Training types CRUD (default seeded durations)
- Packages CRUD
- Client package purchases with session tracking
- Trainers CRUD (supported training types + assigned branches)
- Branch/location management (3 branches seeded)
- Calendar/bookings workflow with business rules:
  - auto end time by training duration
  - prevent trainer overlap
  - require valid active package with remaining sessions
  - session deduction when status becomes `completed` or `no-show`
  - reversible session restore when returning to `booked` or `cancelled`
- Payments and expenses modules

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Optional env setup:
   ```bash
   cp .env.example .env
   ```
3. Set `MONGODB_URI` in `.env` to a MongoDB Atlas connection string.
4. Start app:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:4000](http://localhost:4000)

## MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster.
2. Create a database user with read/write access.
3. Add your IP address for local testing, or allow Render outbound access.
4. Copy the connection string and set:
   ```bash
   MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/ez-gym?retryWrites=true&w=majority
   JWT_SECRET=use_a_long_random_secret
   ```

## Migrating Existing SQLite Data

The app no longer reads SQLite at runtime, but the SQLite database is kept for backup/migration.

Before migration:
- Do not run `npm run seed` or `npm run reset-db`.
- Keep `data/gym.sqlite` in place.
- Stop any running app process that might write to SQLite.

Run:
```bash
npm run migrate:mongo
```

The migration script:
- Opens `data/gym.sqlite` read-only.
- Creates `data/gym_backup_before_mongo_migration.sqlite`.
- Upserts Mongo documents by each SQLite row's numeric ID, stored as `legacyId`.
- Preserves API-facing numeric `id` values so the frontend continues to work.
- Can be rerun without duplicating records.

Migration order:
1. users, branches, training types, clients
2. trainers
3. packages
4. purchases
5. payments and expenses
6. bookings

## Render Deployment

1. Create a Render Web Service from this repository.
2. Use:
   ```bash
   npm install
   npm start
   ```
3. Add environment variables in Render:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `PORT` is supplied by Render automatically, but keeping `PORT=4000` locally is fine.
4. Run `npm run migrate:mongo` locally or from a one-off Render shell before using the deployed app with existing data.

## Seeded defaults

- Training types:
  - EMS (30m)
  - PT (60m)
  - Slimming Machine (30m)
  - Sauna Blanket Machine (40m)
- Branches:
  - Branch 1
  - Branch 2
  - Branch 3
- Example packages
- Super admin user:
  - username: `jimmy`
  - password: `jimmy123`

## Scripts

- `npm run dev` - run with nodemon
- `npm start` - run production-style
- `npm run migrate:mongo` - migrate existing SQLite data to MongoDB Atlas
- `npm run cleanup` - controlled SQLite cleanup utility for migration preparation
- `npm run seed` - legacy SQLite seed script; do not use for MongoDB deployment
- `npm run reset-db` - legacy SQLite reset script; do not use for MongoDB deployment

## Project structure

- `src/server.js` - Express API and business logic
- `src/mongo/` - MongoDB connection, models, and serializers
- `src/migrate-sqlite-to-mongo.js` - idempotent SQLite-to-Mongo migration
- `src/db.js` - legacy SQLite connection + schema for migration/backup scripts
- `src/seed.js` - legacy SQLite seed/reset script
- `src/middleware/auth.js` - JWT middleware
- `public/` - frontend (HTML/CSS/JS)
- `data/` - local SQLite file and migration backups
