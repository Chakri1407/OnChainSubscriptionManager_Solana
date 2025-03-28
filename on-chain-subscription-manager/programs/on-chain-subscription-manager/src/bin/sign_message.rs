#[cfg(feature = "offchain")]
use solana_sdk::signature::{Keypair, Signer};
#[cfg(feature = "offchain")]
use std::env;
#[cfg(feature = "offchain")]
use dotenv::dotenv;

#[cfg(feature = "offchain")]
fn main() {
    dotenv().ok();
    let private_key = env::var("PHANTOM_PRIVATE_KEY").expect("PHANTOM_PRIVATE_KEY must be set");
    let private_key_bytes = bs58::decode(&private_key)
        .into_vec()
        .expect("Invalid private key format");
    let keypair = Keypair::from_bytes(&private_key_bytes).expect("Failed to parse keypair");

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let message = format!("Sign in to Subscription Manager: {}", timestamp);

    let signature = keypair.sign_message(message.as_bytes());
    let signature_bs58 = bs58::encode(signature).into_string();

    println!("Public Key: {}", keypair.pubkey());
    println!("Signature: {}", signature_bs58);
    println!("Timestamp: {}", timestamp);
}

#[cfg(not(feature = "offchain"))]
fn main() {
    panic!("This binary requires the 'offchain' feature. Run with `cargo run --bin sign_message --features offchain`");
}