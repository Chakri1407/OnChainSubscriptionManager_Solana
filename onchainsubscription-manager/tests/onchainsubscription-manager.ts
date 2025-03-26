import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { OnChainSubscriptionManager } from "../target/types/On_chain_subscription_manager"; 
import { assert } from "chai";

describe("On-Chain Subscription Manager Tests - Devnet", () => {
  // Setup Anchor provider and program for Devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(
    connection,
    anchor.Wallet.local(), // Uses the local keypair from ~/.config/solana/id.json
    { preflightCommitment: "confirmed", commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.OnChainSubscriptionManager as Program<OnChainSubscriptionManager>;

  // Keypairs and accounts
  const user = provider.wallet as anchor.Wallet;
  const treasury = web3.Keypair.generate(); // Treasury account to receive payments
  let subscriptionPda: PublicKey;
  let bump: number;

  const PLAN_ID = new BN(1);
  const DURATION = new BN(5); // 5 seconds for testing
  const AMOUNT = new BN(LAMPORTS_PER_SOL / 10); // 0.1 SOL to stay under Devnet airdrop limits

  before(async () => {
    console.log("Running tests on Devnet");
    console.log("Program ID:", program.programId.toString());
    console.log("User Public Key:", user.publicKey.toString());

    // Fund the user wallet with an airdrop (Devnet limit is typically 2 SOL per request)
    try {
      const userBalance = await provider.connection.getBalance(user.publicKey);
      if (userBalance < LAMPORTS_PER_SOL) {
        console.log("Requesting airdrop for user...");
        const airdropSig = await provider.connection.requestAirdrop(
          user.publicKey,
          LAMPORTS_PER_SOL * 2 // Request 2 SOL
        );
        await provider.connection.confirmTransaction(airdropSig);
        console.log("User airdrop confirmed");
      }
    } catch (err) {
      console.error("Airdrop to user failed:", err);
      throw err;
    }

    // Fund the treasury account
    try {
      console.log("Requesting airdrop for treasury...");
      const treasuryAirdropSig = await provider.connection.requestAirdrop(
        treasury.publicKey,
        LAMPORTS_PER_SOL // 1 SOL for rent exemption
      );
      await provider.connection.confirmTransaction(treasuryAirdropSig);
      console.log("Treasury airdrop confirmed");
    } catch (err) {
      console.error("Airdrop to treasury failed:", err);
      throw err;
    }

    // Derive the subscription PDA
    [subscriptionPda, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from("subscription"),
        user.publicKey.toBuffer(),
        PLAN_ID.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log("Subscription PDA:", subscriptionPda.toString());
  });

  it("Creates a subscription", async () => {
    try {
      await program.methods
        .createSubscription(PLAN_ID, DURATION, AMOUNT)
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription created successfully");
      console.log("Subscription data:", subscriptionAccount);
      assert.isTrue(subscriptionAccount.active, "Subscription should be active");
      assert.isTrue(subscriptionAccount.amount.eq(AMOUNT), "Amount should match");
      assert.equal(subscriptionAccount.history.length, 1, "History should have 1 entry");
    } catch (err) {
      console.error("Create subscription failed:", err);
      throw err;
    }
  });

  it("Updates the subscription", async () => {
    const newDuration = new BN(20); // Update to 20 seconds
    const newAmount = new BN(LAMPORTS_PER_SOL / 5); // Update to 0.2 SOL

    try {
      await program.methods
        .updateSubscription(newDuration, newAmount)
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .rpc();
      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription updated successfully");
      assert.isTrue(subscriptionAccount.duration.eq(newDuration), "Duration should be updated");
      assert.isTrue(subscriptionAccount.amount.eq(newAmount), "Amount should be updated");
    } catch (err) {
      console.error("Update subscription failed:", err);
      throw err;
    }
  });

  it("Renews the subscription after expiration", async () => {
    // Wait longer than the duration to ensure expiration (10 seconds + buffer for Devnet latency)
    console.log("Waiting 15 seconds for subscription to expire...");
    await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds

    try {
      await program.methods
        .renewSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription renewed successfully");
      assert.equal(subscriptionAccount.history.length, 2, "History should have 2 entries");
      assert.isTrue(subscriptionAccount.active, "Subscription should remain active");
    } catch (err) {
      console.error("Renew subscription failed:", err);
      throw err;
    }
  });

  it("Cancels the subscription", async () => {
    try {
      await program.methods
        .cancelSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .rpc();
      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription canceled successfully");
      assert.isFalse(subscriptionAccount.active, "Subscription should be inactive");
    } catch (err) {
      console.error("Cancel subscription failed:", err);
      throw err;
    }
  });

  it("Fails to update an inactive subscription", async () => {
    try {
      await program.methods
        .updateSubscription(new BN(30), new BN(LAMPORTS_PER_SOL / 10))
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(
        error?.error.errorCode.code,
        "InactiveSubscription",
        "Expected InactiveSubscription error"
      );
      console.log("✅ Failed to update inactive subscription as expected");
    }
  });

  it("Closes the subscription", async () => {
    try {
      await program.methods
        .closeSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .rpc();
      const subscriptionAccount = await program.account.subscription.fetchNullable(subscriptionPda);
      console.log("✅ Subscription closed successfully");
      assert.isNull(subscriptionAccount, "Subscription account should be closed");
    } catch (err) {
      console.error("Close subscription failed:", err);
      throw err;
    }
  });
});