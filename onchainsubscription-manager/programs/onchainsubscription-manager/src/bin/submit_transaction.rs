use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    signature::Keypair, // Removed Signer
    transaction::Transaction,
};
use std::fs;
use serde_json;
use base64::{engine::general_purpose, Engine as _};
use bincode;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Step 1: Read the keypair from test-keypair.json
    let keypair_json = fs::read_to_string("test-keypair.json")?;
    let keypair_bytes: Vec<u8> = serde_json::from_str(&keypair_json)?;
    if keypair_bytes.len() != 64 {
        return Err("Keypair must be exactly 64 bytes".into());
    }
    let keypair = Keypair::from_bytes(&keypair_bytes)?;

    // Step 2: Deserialize the transaction
    let serialized_tx = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIFMWGRCTGY3/KlZggT4nwxeeWUcnBR+24jnnc+ZIKs69klMfqn2E+Tk/xceRTWcM3mypVYZNzbmz5sq921U/Y9UVZ6WLFEGGKz1O2Avko6amtGLUdgrkXXwCAqF7QRO4bxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACX8cVcapEqoAtvuVzkSuIivf9EvbMs9scP8mJ1YWZbC00Qr3399uTU2bhQ83A88CZXWJ/OlDnvzyJ8k+w1VSN/AQQEAgABAxwAAAAAAQAAAAAAAAAAjScAAAAAAEBCDwAAAAAA";
    let tx_bytes = general_purpose::STANDARD.decode(serialized_tx)?;
    let mut transaction: Transaction = bincode::deserialize(&tx_bytes)?;

    // Step 3: Sign the transaction
    transaction.sign(&[&keypair], transaction.message.recent_blockhash);

    // Step 4: Submit the transaction to Solana Devnet
    let rpc_client = RpcClient::new("https://api.devnet.solana.com".to_string());
    let signature = rpc_client
        .send_and_confirm_transaction(&transaction)
        .await
        .map_err(|e| format!("Failed to send transaction: {}", e))?;

    // Step 5: Print the transaction signature
    println!("Transaction submitted successfully!");
    println!("Signature: {}", signature);
    println!("View on Solana Explorer: https://explorer.solana.com/tx/{}?cluster=devnet", signature);

    Ok(())
}