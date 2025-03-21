# Solana Subscription Manager API Documentation

## Overview

This document outlines the architecture and implementation of a Subscription Management API built on Solana blockchain. The system allows users to create, manage, and renew subscriptions with Solana wallet authentication.

## Tech Stack

- **Backend**: Rust with Actix Web
- **Database**: SQLite (for storing subscription references)
- **Blockchain**: Solana (for transaction validation and subscription state)
- **Authentication**: JWT with Solana wallet signatures

## System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Client App  │────▶│  REST API    │────▶│  Solana      │
│              │◀────│  (Actix Web) │◀────│  Blockchain  │
└──────────────┘     └──────────┬───┘     └──────────────┘
                               │
                     ┌─────────▼────────┐
                     │   SQLite DB      │
                     │ (Metadata Store) │
                     └──────────────────┘

```

## Core Components

### 1. Configuration (`Config`)

- Server host and port
- Solana RPC URL
- Program ID for the Solana smart contract
- JWT secret for authentication

### 2. Authentication Service (`AuthService`)

Handles wallet-based authentication:

- Verifies wallet signatures against messages
- Issues JWT tokens for authenticated sessions
- Validates tokens on protected endpoints

### 3. Solana Service (`SolanaService`)

Interfaces with the Solana blockchain:

- Creates subscription records on-chain
- Retrieves subscription data from blockchain
- Processes subscription renewals as Solana transactions

### 4. Subscription Service (`SubscriptionService`)

Manages subscription logic:

- Stores metadata in SQLite
- Coordinates between database and blockchain
- Provides CRUD operations for subscriptions

### 5. Authentication Middleware

- Intercepts requests to protected endpoints
- Validates JWT tokens
- Injects user context into request pipeline

## Data Models

### Authentication

**AuthRequest:**

```rust
struct AuthRequest {
    public_key: String,
    signature: String,
    timestamp: i64,
}

```

**AuthResponse:**

```rust
struct AuthResponse {
    token: String,
    expires_in: u64,
    public_key: String,
}

```

**JWT Claims:**

```rust
struct Claims {
    sub: String,  // public key
    exp: u64,     // expiration timestamp
    iat: u64,     // issued at timestamp
}

```

### Subscriptions

**SubscriptionRequest:**

```rust
struct SubscriptionRequest {
    name: String,
    price: u64,
    interval: u32,  // in seconds
}

```

**SubscriptionResponse:**

```rust
struct SubscriptionResponse {
    id: String,
    name: String,
    price: u64,
    interval: u32,
    owner: String,
    last_renewal: Option<i64>,
}

```

**UpdateSubscriptionRequest:**

```rust
struct UpdateSubscriptionRequest {
    name: Option<String>,
    price: Option<u64>,
    interval: Option<u32>,
}

```

## API Endpoints

### Authentication

- **POST /api/auth**
    - Authenticate with wallet signature
    - Request: `AuthRequest`
    - Response: `AuthResponse`

### Subscriptions (all require authentication)

- **GET /api/subscriptions**
    - List all subscriptions for authenticated user
    - Response: Array of `SubscriptionResponse`
- **GET /api/subscriptions/{id}**
    - Get a specific subscription
    - Response: `SubscriptionResponse`
- **POST /api/subscriptions**
    - Create a new subscription
    - Request: `SubscriptionRequest`
    - Response: `SubscriptionResponse`
- **PUT /api/subscriptions/{id}**
    - Update an existing subscription
    - Request: `UpdateSubscriptionRequest`
    - Response: `SubscriptionResponse`
- **DELETE /api/subscriptions/{id}**
    - Delete a subscription
    - Response: 204 No Content
- **POST /api/subscriptions/{id}/renew**
    - Renew a subscription
    - Response: `SubscriptionResponse`

## Authentication Flow

```
┌─────────┐                         ┌────────┐                             ┌────────┐
│ Client  │                         │  API   │                             │ Solana │
└────┬────┘                         └────┬───┘                             └────┬───┘
     │                                   │                                      │
     │  1. Generate Message + Timestamp  │                                      │
     ├───────────────────────────────────┘                                      │
     │                                                                          │
     │  2. Sign Message with Wallet                                             │
     │◀─────────────────────────────────────────────────────────────────────────┘
     │                                                                          │
     │  3. POST /api/auth                                                       │
     │  (public_key, signature, timestamp)                                      │
     ├───────────────────────────────────▶                                      │
     │                                   │                                      │
     │                                   │  4. Verify Signature                 │
     │                                   ├─────────────────────────────────────▶│
     │                                   │                                      │
     │                                   │  5. Generate JWT                     │
     │                                   │◀─────────────────────────────────────┘
     │                                   │                                      │
     │  6. Return JWT Token              │                                      │
     │◀──────────────────────────────────┘                                      │
     │                                                                          │
     │  7. Include JWT in Authorization  │                                      │
     │     header for future requests    │                                      │
     │                                   │                                      │

```

## Solana Integration

The system uses Solana blockchain for:

1. **Authentication**: Verifying wallet signatures
2. **Subscription Creation**: Creating Program Derived Addresses (PDAs) for each subscription
3. **Subscription Renewal**: Processing payments via Solana transactions

### Subscription Account Structure

Each subscription is stored on-chain as a PDA derived from:

- The subscription program ID
- The owner's public key
- A unique subscription ID

## Error Handling

The API includes a comprehensive error handling system:

- Authentication errors (401)
- Bad request errors (400)
- Not found errors (404)
- Solana-related errors (502)
- Internal server errors (500)
- Database errors (500)

## Database Schema

```sql
CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY,
    owner TEXT
);

```

Note: Most subscription data is stored on-chain, with the database acting as a reference index.

## Security Considerations

1. **Authentication**:
    - Messages include timestamps to prevent replay attacks
    - Signatures are verified using Solana's cryptography
2. **API Security**:
    - JWT tokens expire after 24 hours
    - Protected routes require valid authentication
    - CORS is configured to allow cross-origin requests
3. **Data Validation**:
    - Input validation for all request parameters
    - Error handling for invalid inputs

## Development Setup

### Environment Variables

```
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
SOLANA_RPC_URL=http://localhost:8899
SOLANA_PROGRAM_ID=your_program_id_here
JWT_SECRET=your_secret_key_here

```

### Building and Running

```bash
cargo build --release
./target/release/solana-subscription-manager

```

## Future Enhancements

1. **Subscription Analytics**: Add metrics and reporting capabilities
2. **Webhook Integration**: Notify external systems on subscription events
3. **Multi-token Support**: Allow subscriptions in different SPL tokens
4. **Advanced Pricing Models**: Implement tiered pricing, discounts, etc.
5. **Admin Dashboard**: Build an administration interface