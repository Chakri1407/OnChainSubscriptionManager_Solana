# On-Chain Subscription Manager

A decentralized subscription management system built on Solana, utilizing a Rust-based backend and an Anchor Solana program to store and manage subscription data entirely on-chain.

## Overview

The **On-Chain Subscription Manager** allows users to create, retrieve, renew, cancel, and close subscriptions using Solana’s blockchain. It eliminates the need for an external database by storing subscription state in program-derived accounts (PDAs). The backend provides a RESTful API for interaction, secured with JWT authentication based on Solana wallet signatures.

### Features
- **Decentralized**: Subscription data is stored on Solana PDAs.
- **Secure Authentication**: Uses Solana wallet signatures and JWTs.
- **Full Lifecycle**: Supports creating, renewing, canceling, and closing subscriptions.
- **No Database**: All data is managed on-chain.
- **RESTful API**: Built with Rust and Actix Web.

### Tech Stack
- **Backend**: Rust, Actix Web, Solana Rust SDK, Borsh, Anchor (serialization)
- **Blockchain**: Solana Devnet, Anchor program
- **Configuration**: `.env` file
- **Testing**: Postman, Solana CLI

## Project Structure
/OnChainSubscriptionManager3/
├── backend/
│   ├── src/
│   │   ├── main.rs         # Backend server
│   │   ├── middlewares.rs  # Authentication middleware
│   ├── .env                # Configuration (not tracked)
│   ├── Cargo.toml          # Rust dependencies
├── programs/
│   ├── on-chain-subscription-manager/
│   │   ├── src/
│   │   │   ├── lib.rs      # Solana program
│   ├── Anchor.toml         # Anchor configuration
├── tests/
│   ├── subscription-manager.js  # Anchor test script
├── package.json            # Node dependencies for testing
├── README.md               # This file


## Prerequisites

- **Rust**: Install with `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Solana CLI**: Install via `sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"`
- **Anchor**: Install with `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force`
- **Node.js**: Required for Anchor tests (`npm install` in root directory)
- **Postman**: For API testing (optional)

## Setup

### 1. Clone the Repository
```bash
git clone <repository-url>
cd OnChainSubscriptionManager3
```
### 2. Configure the Backend
Create a .env file in the backend/ directory:

```bash
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_PROGRAM_ID=6sQWJct5BtcfWSQEpzzxvi5t3Ba3tE3p3fp54tXw5PUS
JWT_SECRET=your-secret-key-here
TREASURY_PUBKEY= < Your treeasury pub key>
PHANTOM_PRIVATE_KEY=<private-key>
```

- Replace PHANTOM_PRIVATE_KEY with the base58 private key.
- Ensure TREASURY_PUBKEY has sufficient SOL (~2 SOL recommended for testing).
### 3. Build the Backend
``` 
cd backend
cargo build
```

### 4. Deploy the Solana Program (if not already deployed)
``` 
cd ..
anchor build
anchor deploy
```
- Update SOLANA_PROGRAM_ID in .env if the deployed program ID differs.
### 5. Run the Backend
```
cd backend
RUST_LOG=info cargo run
```

- Server starts at http://127.0.0.1:8080.
## Usage
### Running the Server
- Start the backend:
```
RUST_LOG=info cargo run
```

- Use RUST_LOG=debug for detailed logs.
## Testing with Postman
1. Authenticate:

- POST http://127.0.0.1:8080/auth
- Body:
```
{
    "public_key": "Ha8xAt36P3SwUZzTXZFPpda3DzcwgKFafeQYLsAN13fd",
    "signature": "<base58-signature>",
    "timestamp": 1743118015
}
```

- Response provides a JWT token.
2. Create a Subscription:
- POST http://127.0.0.1:8080/api/subscriptions
- Headers: Authorization: Bearer <jwt-token>
- Body:
``` 
{
    "plan_id": 1,
    "duration": 60,
    "amount": 1000000
}

```

3. Retrieve Subscription:
- GET http://127.0.0.1:8080/api/subscriptions/1
- Headers: Authorization: Bearer <jwt-token>
4. Renew, Cancel, Close:

- Use POST /api/subscriptions/1/renew, /cancel, /close with the same header.
### CLI Verification
- Check an account:
```
solana account 9HZ45GCgySsPgiTY6eToaGggT7BZHXhZZxUvgQPZafHL --url https://api.devnet.solana.com
```

## API Documentation

### Base URL
http://127.0.0.1:8080

### Endpoints
### POST /auth
- Description: Authenticates a user with a signed message.
- Request:
```
{
    "public_key": "Ha8xAt36P3SwUZzTXZFPpda3DzcwgKFafeQYLsAN13fd",
    "signature": "<base58-signature>",
    "timestamp": 1743118015
}
```

- Response:

```
{
    "token": "<jwt-token>",
    "expires_in": 86400,
    "public_key": "Ha8xAt36P3SwUZzTXZFPpda3DzcwgKFafeQYLsAN13fd"
}
```

### POST /api/subscriptions
- Description: Creates a new subscription.
- Headers: Authorization: Bearer <jwt-token>
- Request:
```
{
    "plan_id": 1,
    "duration": 60,
    "amount": 1000000
}
```
- Response:
```
{
    "signature": "<transaction-signature>"
}
```

### GET /api/subscriptions/{plan_id}
- Description: Retrieves subscription details.
- Headers: Authorization: Bearer <jwt-token>
- Example: GET /api/subscriptions/1
- Response:
```
{
    "id": "9HZ45GCgySsPgiTY6eToaGggT7BZHXhZZxUvgQPZafHL",
    "plan_id": 1,
    "duration": 60,
    "amount": 1000000,
    "active": true,
    "start_time": 1743123080,
    "history": [1743123080],
    "owner": "Ha8xAt36P3SwUZzTXZFPpda3DzcwgKFafeQYLsAN13fd"
}
```
### POST /api/subscriptions/{plan_id}/renew
- Description: Renews an expired subscription.
- Headers: Authorization: Bearer <jwt-token>
- Example: POST /api/subscriptions/1/renew
- Response:
```
{
    "signature": "<transaction-signature>"
}
```
### POST /api/subscriptions/{plan_id}/cancel
- Description: Cancels an active subscription.
- Headers: Authorization: Bearer <jwt-token>
- Example: POST /api/subscriptions/1/cancel
- Response:
```
{
    "signature": "<transaction-signature>"
}
```
### POST /api/subscriptions/{plan_id}/close
- Description: Closes a subscription, deleting the account.
- Headers: Authorization: Bearer <jwt-token>
- Example: POST /api/subscriptions/1/close
- Response:
```
{
    "signature": "<transaction-signature>"
}
```

## Solana Program
- Program ID: 6sQWJct5BtcfWSQEpzzxvi5t3Ba3tE3p3fp54tXw5PUS
- Account: Subscription
     - Size: 157 bytes
     - Fields:
        - user: Pubkey (32 bytes)
        - plan_id: u64 (8 bytes)
        - start_time: i64 (8 bytes)
        - duration:u64 (8 bytes)
        - amount: u64 (8 bytes)
        - active: bool (1 byte)
        - history: Vec<i64> (4 bytes len + 8 bytes/entry, max 10 entries)
- Instructions:
    - create_subscription: Initializes a subscription PDA.
    - renew_subscription: Renews expired subscriptions.
    - cancel_subscription: Sets active to false.
    - close_subscription: Deletes the PDA.
## Contributing
1. Fork the repository.
2. Create a feature branch (git checkout -b feature/your-feature).
3. Commit changes (git commit -m "Add your feature").
4. Push to the branch (git push origin feature/your-feature).
5. Open a pull request.

### Development Tips

- Use RUST_LOG=debug for detailed logs.
- Test endpoints with Postman or curl.
- Ensure Solana program and backend structs remain aligned.

## Troubleshooting

- "Account already in use": Delete the existing PDA or use a different plan_id.
- "Deserialization error": Verify Subscription struct matches on-chain data.
- "Transaction failed": Check logs for simulation errors, ensure treasury has SOL.
- "Invalid signature": Confirm timestamp is within 24 hours and signature matches message.

### License
MIT License - feel free to use, modify, and distribute this code.