use solana_sdk::signature::{Keypair, Signer};
use std::fs;
use serde_json;

fn main() {
    // Read the keypair JSON file
    let keypair_json = match fs::read_to_string("test-keypair.json") {
        Ok(json) => json,
        Err(e) => panic!("Failed to read test-keypair.json: {}", e),
    };
    println!("Raw JSON: {}", keypair_json);

    // Deserialize JSON into Vec<u8>
    let keypair_bytes: Vec<u8> = match serde_json::from_str(&keypair_json) {
        Ok(bytes) => bytes,
        Err(e) => panic!("Failed to parse JSON: {}", e),
    };
    println!("Deserialized bytes: {:?}", keypair_bytes);
    println!("Byte length: {}", keypair_bytes.len());

    // Ensure it’s 64 bytes
    if keypair_bytes.len() != 64 {
        panic!("Keypair must be exactly 64 bytes, got {}", keypair_bytes.len());
    }

    // Convert to array and parse keypair
    let keypair = Keypair::from_bytes(&keypair_bytes).expect("Failed to parse keypair");

    // Use a current timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let message = format!("Sign in to Subscription Manager: {}", timestamp);

    // Sign the message
    let signature = keypair.sign_message(message.as_bytes());
    let signature_bs58 = bs58::encode(signature).into_string();

    // Print the results
    println!("Public Key: {}", keypair.pubkey());
    println!("Signature: {}", signature_bs58);
    println!("Message: {}", message);
}