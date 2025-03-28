import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Connection, Keypair, Transaction } from "@solana/web3.js";
import { OnChainSubscriptionManager } from "../target/types/on_chain_subscription_manager"; 
import { assert } from "chai";
import * as bs58 from "bs58";
import * as dotenv from "dotenv";

dotenv.config();

describe("On-Chain Subscription Manager Tests - Devnet", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(
    connection,
    anchor.Wallet.local(),
    { preflightCommitment: "confirmed", commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.OnChainSubscriptionManager as Program<OnChainSubscriptionManager>;

  const user = provider.wallet as anchor.Wallet;
  const treasury = user.publicKey;
  let subscriptionPda: PublicKey;
  let bump: number;

  const PLAN_ID = new BN(1);
  const DURATION = new BN(30);
  const AMOUNT = new BN(LAMPORTS_PER_SOL / 10);

  const phantomPrivateKey = process.env.PHANTOM_PRIVATE_KEY;
  if (!phantomPrivateKey) throw new Error("PHANTOM_PRIVATE_KEY not set in .env");
  const phantomKeypair = Keypair.fromSecretKey(bs58.decode(phantomPrivateKey));
  const phantomPublicKey = phantomKeypair.publicKey;

  // Helper function to check and close an existing subscription
  async function ensurePdaClosed(pda: PublicKey) {
    const account = await program.account.subscription.fetchNullable(pda);
    if (account && !account.active) {
      console.log(`Closing existing inactive subscription at ${pda.toString()}`);
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .closeSubscription()
        .accounts({
          subscription: pda,
          user: user.publicKey,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Failed to close existing subscription");
    } else if (account && account.active) {
      console.log(`Canceling active subscription at ${pda.toString()} before closing`);
      await program.methods
        .cancelSubscription()
        .accounts({
          subscription: pda,
          user: user.publicKey,
        })
        .rpc();
      await ensurePdaClosed(pda); // Recursively close after canceling
    }
  }

  before(async () => {
    console.log("Running tests on Devnet");
    console.log("Program ID:", program.programId.toString());
    console.log("User Public Key (Test Wallet):", user.publicKey.toString());
    console.log("Phantom Public Key:", phantomPublicKey.toString());
    console.log("Treasury Public Key (for .env and Postman):", treasury.toString());

    const userBalance = await provider.connection.getBalance(user.publicKey);
    console.log("User Balance:", userBalance / LAMPORTS_PER_SOL, "SOL");

    if (userBalance < LAMPORTS_PER_SOL) {
      console.log("Funding test wallet from Phantom wallet...");
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const transferTx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: phantomPublicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: phantomPublicKey,
          toPubkey: user.publicKey,
          lamports: LAMPORTS_PER_SOL * 2,
        }),
        web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 })
      );

      const signedTx = await phantomKeypair.sign(transferTx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Funding Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Funding transaction failed to confirm within 60 seconds");
      console.log("Test wallet funded successfully");
    }

    [subscriptionPda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), PLAN_ID.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    console.log("Subscription PDA:", subscriptionPda.toString());

    // Ensure the initial PDA is clean
    await ensurePdaClosed(subscriptionPda);
  });

  it("Creates a subscription", async () => {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .createSubscription(PLAN_ID, DURATION, AMOUNT)
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription created successfully");
      console.log("Subscription data:", subscriptionAccount);
      assert.isTrue(subscriptionAccount.active);
      assert.isTrue(subscriptionAccount.amount.eq(AMOUNT));
      assert.equal(subscriptionAccount.history.length, 1);
    } catch (err) {
      console.error("Create subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Updates the subscription", async () => {
    const newDuration = new BN(20);
    const newAmount = new BN(LAMPORTS_PER_SOL / 5);

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .updateSubscription(newDuration, newAmount)
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription updated successfully");
      assert.isTrue(subscriptionAccount.duration.eq(newDuration));
      assert.isTrue(subscriptionAccount.amount.eq(newAmount));
    } catch (err) {
      console.error("Update subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Renews the subscription after expiration", async () => {
    console.log("Waiting 35 seconds for subscription to expire...");
    await new Promise((resolve) => setTimeout(resolve, 35000));

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .renewSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription renewed successfully");
      assert.equal(subscriptionAccount.history.length, 2);
      assert.isTrue(subscriptionAccount.active);
    } catch (err) {
      console.error("Renew subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Cancels the subscription", async () => {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .cancelSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
      console.log("✅ Subscription canceled successfully");
      assert.isFalse(subscriptionAccount.active);
    } catch (err) {
      console.error("Cancel subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Fails to update an inactive subscription", async () => {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .updateSubscription(new BN(30), new BN(LAMPORTS_PER_SOL / 10))
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await provider.connection.confirmTransaction(txSig); // This should fail
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "InactiveSubscription");
      console.log("✅ Failed to update inactive subscription as expected");
    }
  });

  it("Closes the subscription", async () => {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .closeSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetchNullable(subscriptionPda);
      console.log("✅ Subscription closed successfully");
      assert.isNull(subscriptionAccount);
    } catch (err) {
      console.error("Close subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Creates a subscription with zero amount", async () => {
    const [newSubscriptionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(2).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await ensurePdaClosed(newSubscriptionPda);

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .createSubscription(new BN(2), DURATION, new BN(0))
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log("Transaction Signature:", txSig);

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");

      const subscriptionAccount = await program.account.subscription.fetch(newSubscriptionPda);
      console.log("✅ Subscription with zero amount created successfully");
      assert.isTrue(subscriptionAccount.active);
      assert.isTrue(subscriptionAccount.amount.eq(new BN(0)));
    } catch (err) {
      console.error("Create zero amount subscription failed:", err);
      if (err instanceof anchor.AnchorError) console.error("Logs:", err.logs);
      throw err;
    }
  });

  it("Fails to renew subscription before expiration", async () => {
    const [newSubscriptionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(3).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await ensurePdaClosed(newSubscriptionPda);

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .createSubscription(new BN(3), DURATION, AMOUNT)
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");
    } catch (err) {
      console.error("Create subscription for renew test failed:", err);
      throw err;
    }

    try {
      await program.methods
        .renewSubscription()
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "NotYetExpired");
      console.log("✅ Failed to renew active subscription as expected");
    }
  });

  it("Fails to update subscription with unauthorized user", async () => {
    const [newSubscriptionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(4).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await ensurePdaClosed(newSubscriptionPda);

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .createSubscription(new BN(4), DURATION, AMOUNT)
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");
    } catch (err) {
      console.error("Create subscription for unauthorized test failed:", err);
      throw err;
    }

    const unauthorizedUser = Keypair.generate();
    try {
      await program.methods
        .updateSubscription(new BN(40), new BN(LAMPORTS_PER_SOL))
        .accounts({
          subscription: newSubscriptionPda,
          user: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "Unauthorized");
      console.log("✅ Failed to update with unauthorized user as expected");
    }
  });

  it("Maintains history limit of 10 entries", async () => {
    const [newSubscriptionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(5).toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await ensurePdaClosed(newSubscriptionPda);

    try {
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .createSubscription(new BN(5), new BN(1), AMOUNT)
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      for (let i = 0; i < 30; i++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Transaction failed to confirm within 60 seconds");
    } catch (err) {
      console.error("Create subscription for history test failed:", err);
      throw err;
    }

    for (let i = 0; i < 11; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { blockhash } = await provider.connection.getLatestBlockhash("confirmed");
      const tx = await program.methods
        .renewSubscription()
        .accounts({
          subscription: newSubscriptionPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.add(web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000 }));

      const signedTx = await user.signTransaction(tx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      let confirmed = false;
      for (let j = 0; j < 30; j++) {
        const status = await provider.connection.getSignatureStatus(txSig);
        if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!confirmed) throw new Error("Renewal transaction failed to confirm within 60 seconds");
    }

    const subscriptionAccount = await program.account.subscription.fetch(newSubscriptionPda);
    console.log("✅ History limit maintained");
    assert.equal(subscriptionAccount.history.length, 10);
    assert.isTrue(subscriptionAccount.active);
  });
});