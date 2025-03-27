mod middlewares;

use actix_cors::Cors;
use actix_web::{
    middleware::Logger,
    web::{self, Data},
    App, HttpResponse, HttpServer, HttpMessage, get, post,
};
use dotenv::dotenv;
use log::info;
use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::Signature,
    transaction::Transaction,
    instruction::Instruction,
    system_program,
    message::Message,
    signer::keypair::Keypair,
};
use solana_client::rpc_request::{RpcError, RpcResponseErrorData};
use anchor_lang::solana_program::hash::hash; // For Anchor discriminator
use borsh::{BorshDeserialize, BorshSerialize}; // Use borsh crate directly
use jsonwebtoken::{encode, Header, EncodingKey, Validation};
use std::time::{SystemTime, UNIX_EPOCH};
use std::str::FromStr;
use middlewares::Authentication;
use std::sync::Arc;

// Configuration
#[derive(Clone)]
pub struct Config {
    server_host: String,
    server_port: u16,
    solana_rpc_url: String,
    program_id: Pubkey,
    jwt_secret: String,
    treasury: Pubkey,
    phantom_private_key: String,
}

pub fn get_config() -> Config {
    dotenv().ok();
    Config {
        server_host: std::env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        server_port: std::env::var("SERVER_PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse()
            .unwrap_or(8080),
        solana_rpc_url: std::env::var("SOLANA_RPC_URL")
            .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
        program_id: Pubkey::from_str("BE8PNroWQBpof1qctnwzftcFKRRVuqbYQ5Xv1LnREQBc")
            .expect("Invalid program ID"),
        jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
        treasury: Pubkey::from_str(
            &std::env::var("TREASURY_PUBKEY").unwrap_or_else(|_| "3WCHd9Z57YfUFb9kaUkq5nyQjyWMVLVHigvYfvSfsHEG".to_string()),
        )
        .expect("Invalid treasury pubkey"),
        phantom_private_key: std::env::var("PHANTOM_PRIVATE_KEY").expect("PHANTOM_PRIVATE_KEY must be set"),
    }
}

// Models
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthRequest {
    public_key: String,
    signature: String,
    timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthResponse {
    token: String,
    expires_in: u64,
    public_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    sub: String,
    exp: u64,
    iat: u64,
}

#[derive(Debug, Clone)]
pub struct AuthToken {
    public_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubscriptionRequest {
    plan_id: u64,
    duration: u64, // in seconds
    amount: u64,   // in lamports
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubscriptionResponse {
    id: String,       // PDA-derived address
    plan_id: u64,
    duration: u64,
    amount: u64,
    active: bool,
    start_time: i64,
    history: Vec<i64>,
    owner: String,
}

// Error Handling
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Authentication error: {0}")]
    Auth(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Solana error: {0}")]
    SolanaError(String),
    #[error("Internal server error: {0}")]
    InternalServerError(String),
}

impl actix_web::ResponseError for AppError {
    fn status_code(&self) -> actix_web::http::StatusCode {
        match self {
            AppError::Auth(_) => actix_web::http::StatusCode::UNAUTHORIZED,
            AppError::BadRequest(_) => actix_web::http::StatusCode::BAD_REQUEST,
            AppError::NotFound(_) => actix_web::http::StatusCode::NOT_FOUND,
            AppError::SolanaError(_) => actix_web::http::StatusCode::BAD_GATEWAY,
            AppError::InternalServerError(_) => actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status_code()).json(serde_json::json!({
            "status": self.status_code().to_string(),
            "message": self.to_string()
        }))
    }
}

pub type AppResult<T> = Result<T, AppError>;

// Solana Service
#[derive(Clone)]
pub struct SolanaService {
    rpc_client: Arc<RpcClient>,
    program_id: Pubkey,
    treasury: Pubkey,
    phantom_keypair: Arc<Keypair>,
}

impl SolanaService {
    pub fn new(config: &Config) -> Self {
        let private_key_bytes = bs58::decode(&config.phantom_private_key)
            .into_vec()
            .expect("Invalid PHANTOM_PRIVATE_KEY format");
        let keypair = Keypair::from_bytes(&private_key_bytes)
            .expect("Failed to parse Phantom private key");

        Self {
            rpc_client: Arc::new(RpcClient::new(config.solana_rpc_url.clone())),
            program_id: config.program_id,
            treasury: config.treasury,
            phantom_keypair: Arc::new(keypair),
        }
    }

    pub async fn create_subscription(
        &self,
        owner: &str,
        req: SubscriptionRequest,
    ) -> AppResult<String> {
        let owner_pubkey = Pubkey::from_str(owner)
            .map_err(|e| AppError::BadRequest(format!("Invalid public key: {}", e)))?;

        let (subscription_pda, _bump) = Pubkey::find_program_address(
            &[b"subscription", owner_pubkey.as_ref(), req.plan_id.to_le_bytes().as_ref()],
            &self.program_id,
        );

        let mut data = hash("global:create_subscription".as_bytes()).to_bytes()[..8].to_vec();
        data.extend_from_slice(&req.plan_id.to_le_bytes());
        data.extend_from_slice(&req.duration.to_le_bytes());
        data.extend_from_slice(&req.amount.to_le_bytes());

        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                solana_sdk::instruction::AccountMeta::new(subscription_pda, false),
                solana_sdk::instruction::AccountMeta::new(owner_pubkey, true),
                solana_sdk::instruction::AccountMeta::new(self.treasury, false),
                solana_sdk::instruction::AccountMeta::new_readonly(system_program::id(), false),
            ],
            data,
        };

        let recent_blockhash = self.rpc_client
            .get_latest_blockhash()
            .await
            .map_err(|e| AppError::SolanaError(format!("Failed to get blockhash: {}", e)))?;
        let message = Message::new_with_blockhash(&[instruction], Some(&owner_pubkey), &recent_blockhash);
        let mut tx = Transaction::new_unsigned(message);

        tx.sign(&[&self.phantom_keypair], recent_blockhash);

        let signature = self.rpc_client
            .send_and_confirm_transaction(&tx)
            .await
            .map_err(|e| {
                if let solana_client::client_error::ClientErrorKind::RpcError(RpcError::RpcResponseError { data, .. }) = &e.kind() {
                    if let RpcResponseErrorData::SendTransactionPreflightFailure(sim) = data {
                        log::error!("Transaction simulation failed: {:?}", sim.logs);
                    }
                }
                AppError::SolanaError(format!("Transaction failed: {}", e))
            })?;

        Ok(signature.to_string())
    }

    pub async fn get_subscription(&self, owner: &str, plan_id: u64) -> AppResult<SubscriptionResponse> {
        let owner_pubkey = Pubkey::from_str(owner)
            .map_err(|e| AppError::BadRequest(format!("Invalid public key: {}", e)))?;

        let (subscription_pda, _bump) = Pubkey::find_program_address(
            &[b"subscription", owner_pubkey.as_ref(), plan_id.to_le_bytes().as_ref()],
            &self.program_id,
        );

        log::info!("Fetching subscription PDA: {}", subscription_pda);

        let account = self.rpc_client
            .get_account(&subscription_pda)
            .await
            .map_err(|e| AppError::SolanaError(format!("Failed to fetch account: {}", e)))?;

        log::info!("Raw account data (len={}): {:?}", account.data.len(), account.data);

        let subscription = Subscription::try_from_slice(&account.data[8..])
            .map_err(|e| AppError::SolanaError(format!("Deserialization error: {}", e)))?;

        Ok(SubscriptionResponse {
            id: subscription_pda.to_string(),
            plan_id: subscription.plan_id,
            duration: subscription.duration,
            amount: subscription.amount,
            active: subscription.active,
            start_time: subscription.start_time,
            history: subscription.history,
            owner: owner.to_string(),
        })
    }

    pub async fn renew_subscription(&self, owner: &str, plan_id: u64) -> AppResult<String> {
        let owner_pubkey = Pubkey::from_str(owner)
            .map_err(|e| AppError::BadRequest(format!("Invalid public key: {}", e)))?;

        let (subscription_pda, _bump) = Pubkey::find_program_address(
            &[b"subscription", owner_pubkey.as_ref(), plan_id.to_le_bytes().as_ref()],
            &self.program_id,
        );

        let data = hash("global:renew_subscription".as_bytes()).to_bytes()[..8].to_vec();
        let instruction = Instruction {
            program_id: self.program_id,
            accounts: vec![
                solana_sdk::instruction::AccountMeta::new(subscription_pda, false),
                solana_sdk::instruction::AccountMeta::new(owner_pubkey, true),
                solana_sdk::instruction::AccountMeta::new(self.treasury, false),
                solana_sdk::instruction::AccountMeta::new_readonly(system_program::id(), false),
            ],
            data,
        };

        let recent_blockhash = self.rpc_client
            .get_latest_blockhash()
            .await
            .map_err(|e| AppError::SolanaError(format!("Failed to get blockhash: {}", e)))?;
        let message = Message::new_with_blockhash(&[instruction], Some(&owner_pubkey), &recent_blockhash);
        let mut tx = Transaction::new_unsigned(message);

        tx.sign(&[&self.phantom_keypair], recent_blockhash);

        let signature = self.rpc_client
            .send_and_confirm_transaction(&tx)
            .await
            .map_err(|e| AppError::SolanaError(format!("Transaction failed: {}", e)))?;

        Ok(signature.to_string())
    }
}

// Subscription struct to deserialize on-chain data
#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct Subscription {
    pub user: Pubkey,
    pub plan_id: u64,
    pub start_time: i64,
    pub duration: u64,
    pub amount: u64,
    pub active: bool,
    pub history: Vec<i64>,
}

// Simplified AuthService
#[derive(Clone)]
pub struct AuthService {
    config: Config,
}

impl AuthService {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub async fn authenticate(&self, req: AuthRequest) -> AppResult<AuthResponse> {
        let current_time = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        if (current_time - req.timestamp).abs() > 86400 {
            return Err(AppError::Auth("Authentication request expired".to_string()));
        }

        let message = format!("Sign in to Subscription Manager: {}", req.timestamp);
        let signature_bytes = bs58::decode(&req.signature)
            .into_vec()
            .map_err(|e| AppError::BadRequest(format!("Invalid signature format: {}", e)))?;
        let signature = Signature::try_from(signature_bytes.as_slice())
            .map_err(|e| AppError::BadRequest(format!("Invalid signature: {}", e)))?;
        let pubkey = Pubkey::from_str(&req.public_key)
            .map_err(|e| AppError::BadRequest(format!("Invalid public key: {}", e)))?;

        if !signature.verify(pubkey.as_ref(), message.as_bytes()) {
            return Err(AppError::Auth("Invalid signature".to_string()));
        }

        let claims = Claims {
            sub: req.public_key.clone(),
            exp: (current_time + 86400) as u64,
            iat: current_time as u64,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.config.jwt_secret.as_bytes()),
        )
        .map_err(|e| AppError::InternalServerError(format!("Failed to create JWT: {}", e)))?;

        Ok(AuthResponse {
            token,
            expires_in: 86400,
            public_key: req.public_key,
        })
    }

    pub fn verify_token(&self, token: &str) -> AppResult<AuthToken> {
        let token_data = jsonwebtoken::decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(self.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| AppError::Auth(format!("Invalid token: {}", e)))?;
        Ok(AuthToken {
            public_key: token_data.claims.sub,
        })
    }
}

// Controllers
#[post("/auth")]
pub async fn authenticate(
    auth_service: web::Data<AuthService>,
    req: web::Json<AuthRequest>,
) -> AppResult<HttpResponse> {
    let auth_response = auth_service.authenticate(req.into_inner()).await?;
    Ok(HttpResponse::Ok().json(auth_response))
}

#[post("/subscriptions")]
pub async fn create_subscription(
    req: actix_web::HttpRequest,
    solana_service: web::Data<SolanaService>,
    sub_req: web::Json<SubscriptionRequest>,
) -> AppResult<HttpResponse> {
    let auth_token = req.extensions().get::<AuthToken>().ok_or(AppError::Auth("No auth token found".to_string()))?.clone();
    let signature = solana_service
        .create_subscription(&auth_token.public_key, sub_req.into_inner())
        .await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "signature": signature })))
}

#[get("/subscriptions/{plan_id}")]
pub async fn get_subscription(
    req: actix_web::HttpRequest,
    path: web::Path<u64>,
    solana_service: web::Data<SolanaService>,
) -> AppResult<HttpResponse> {
    let auth_token = req.extensions().get::<AuthToken>().ok_or(AppError::Auth("No auth token found".to_string()))?.clone();
    let plan_id = path.into_inner();
    let sub = solana_service.get_subscription(&auth_token.public_key, plan_id).await?;
    Ok(HttpResponse::Ok().json(sub))
}

#[post("/subscriptions/{plan_id}/renew")]
pub async fn renew_subscription(
    req: actix_web::HttpRequest,
    path: web::Path<u64>,
    solana_service: web::Data<SolanaService>,
) -> AppResult<HttpResponse> {
    let auth_token = req.extensions().get::<AuthToken>().ok_or(AppError::Auth("No auth token found".to_string()))?.clone();
    let plan_id = path.into_inner();
    let signature = solana_service.renew_subscription(&auth_token.public_key, plan_id).await?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "signature": signature })))
}

// Main
#[tokio::main(worker_threads = 4)]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init();

    let config = get_config();
    info!("Starting server at {}:{}", config.server_host, config.server_port);

    let solana_service = SolanaService::new(&config);
    let auth_service = AuthService::new(config.clone());

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(Logger::default())
            .wrap(cors)
            .app_data(Data::new(auth_service.clone()))
            .app_data(Data::new(solana_service.clone()))
            .service(authenticate)
            .service(
                web::scope("/api")
                    .wrap(Authentication::new(auth_service.clone()))
                    .service(create_subscription)
                    .service(get_subscription)
                    .service(renew_subscription)
            )
    })
    .bind((config.server_host, config.server_port))?
    .run()
    .await
}