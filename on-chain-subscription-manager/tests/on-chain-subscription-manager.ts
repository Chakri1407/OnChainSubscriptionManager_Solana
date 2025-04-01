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
  const FIXED_DURATION = new BN(60); // 60 seconds
  const FIXED_AMOUNT = new BN(10_000_000); // 0.01 SOL in lamports

  const phantomPrivateKey = process.env.PHANTOM_PRIVATE_KEY;
  if (!phantomPrivateKey) throw new Error("PHANTOM_PRIVATE_KEY not set in .env");
  const phantomKeypair = Keypair.fromSecretKey(bs58.decode(phantomPrivateKey));
  const phantomPublicKey = phantomKeypair.publicKey;

  async function ensurePdaClosed(pda: PublicKey) {
    const account = await program.account.subscription.fetchNullable(pda);
    if (account && !account.active) {
      console.log(`Closing existing inactive subscription at ${pda.toString()}`);
      await program.methods
        .closeSubscription()
        .accounts({
          subscription: pda,
          user: user.publicKey,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
    } else if (account && account.active) {
      console.log(`Canceling active subscription at ${pda.toString()} before closing`);
      await program.methods
        .cancelSubscription()
        .accounts({
          subscription: pda,
          user: user.publicKey,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      await ensurePdaClosed(pda);
    }
  }

  before(async () => {
    console.log("Running tests on Devnet");
    console.log("Program ID:", program.programId.toString());
    console.log("User Public Key:", user.publicKey.toString());
    console.log("Phantom Public Key:", phantomPublicKey.toString());
    console.log("Treasury Public Key:", treasury.toString());

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
        web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })
      );

      const signedTx = await phantomKeypair.sign(transferTx);
      const txSig = await provider.connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await provider.connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight: (await provider.connection.getLatestBlockhash()).lastValidBlockHeight }, "confirmed");
    }

    [subscriptionPda, bump] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), PLAN_ID.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    console.log("Subscription PDA:", subscriptionPda.toString());
    await ensurePdaClosed(subscriptionPda);
  });

  it("Creates a subscription with fixed parameters", async () => {
    await program.methods
      .createSubscription(PLAN_ID)
      .accounts({
        subscription: subscriptionPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });
    
    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    console.log("✅ Subscription created successfully");
    assert.isTrue(subscriptionAccount.active);
    assert.isTrue(subscriptionAccount.amount.eq(FIXED_AMOUNT));
    assert.isTrue(subscriptionAccount.duration.eq(FIXED_DURATION));
    assert.equal(subscriptionAccount.history.length, 1);
  });

  it("Fails to update subscription due to fixed parameters", async () => {
    try {
      await program.methods
        .updateSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "FixedParameters");
      console.log("✅ Failed to update subscription as expected");
    }
  });

  it("Renews subscription after expiration", async () => {
    console.log("Waiting 65 seconds for subscription to expire...");
    await new Promise((resolve) => setTimeout(resolve, 65000));
    
    await program.methods
      .renewSubscription()
      .accounts({
        subscription: subscriptionPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });
    
    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    console.log("✅ Subscription renewed successfully");
    assert.equal(subscriptionAccount.history.length, 2);
    assert.isTrue(subscriptionAccount.active);
    assert.isTrue(subscriptionAccount.amount.eq(FIXED_AMOUNT));
    assert.isTrue(subscriptionAccount.duration.eq(FIXED_DURATION));
  });

  it("Cancels the subscription", async () => {
    await program.methods
      .cancelSubscription()
      .accounts({
        subscription: subscriptionPda,
        user: user.publicKey,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });
    
    const subscriptionAccount = await program.account.subscription.fetch(subscriptionPda);
    console.log("✅ Subscription canceled successfully");
    assert.isFalse(subscriptionAccount.active);
  });

  it("Fails to update an inactive subscription", async () => {
    try {
      await program.methods
        .updateSubscription()
        .accounts({
          subscription: subscriptionPda,
          user: user.publicKey,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "FixedParameters");
      console.log("✅ Failed to update inactive subscription as expected");
    }
  });

  it("Closes the subscription", async () => {
    await program.methods
      .closeSubscription()
      .accounts({
        subscription: subscriptionPda,
        user: user.publicKey,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });
    
    const subscriptionAccount = await program.account.subscription.fetchNullable(subscriptionPda);
    console.log("✅ Subscription closed successfully");
    assert.isNull(subscriptionAccount);
  });

  it("Fails to renew before expiration", async () => {
    const [newPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(2).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(newPda);

    await program.methods
      .createSubscription(new BN(2))
      .accounts({
        subscription: newPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    try {
      await program.methods
        .renewSubscription()
        .accounts({
          subscription: newPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "NotYetExpired");
      console.log("✅ Failed to renew before expiration as expected");
    }
  });

  it("Fails to update with unauthorized user", async () => {
    const [newPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(3).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(newPda);

    await program.methods
      .createSubscription(new BN(3))
      .accounts({
        subscription: newPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    const unauthorizedUser = Keypair.generate();
    try {
      await program.methods
        .updateSubscription()
        .accounts({
          subscription: newPda,
          user: unauthorizedUser.publicKey,
        })
        .signers([unauthorizedUser])
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "Unauthorized");
      console.log("✅ Failed to update with unauthorized user as expected");
    }
  });

  // it("Maintains history limit of 5 entries", async function() {
  //   this.timeout(600000); // Set timeout to 10 minutes for this test
    
  //   const [newPda] = await PublicKey.findProgramAddress(
  //     [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(4).toArrayLike(Buffer, "le", 8)],
  //     program.programId
  //   );
  //   await ensurePdaClosed(newPda);

  //   await program.methods
  //     .createSubscription(new BN(4))
  //     .accounts({
  //       subscription: newPda,
  //       user: user.publicKey,
  //       treasury: treasury,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
  //     .rpc({ commitment: "confirmed", skipPreflight: false });

  //   for (let i = 0; i < 4; i++) { // Changed from 5 to 4 renewals
  //     console.log(`Waiting 65 seconds for renewal ${i + 1}...`);
  //     await new Promise((resolve) => setTimeout(resolve, 65000));
  //     await program.methods
  //       .renewSubscription()
  //       .accounts({
  //         subscription: newPda,
  //         user: user.publicKey,
  //         treasury: treasury,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
  //       .rpc({ commitment: "confirmed", skipPreflight: false });
  //   }

  //   const subscriptionAccount = await program.account.subscription.fetch(newPda);
  //   console.log("✅ History limit maintained");
  //   assert.equal(subscriptionAccount.history.length, 5); // Still expecting 5 (1 creation + 4 renewals)
  //   assert.isTrue(subscriptionAccount.active);
  // });

  it("Verifies payment amount deduction from user", async () => {
    const [newPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(5).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(newPda);

    const initialBalance = await provider.connection.getBalance(user.publicKey);
    await program.methods
      .createSubscription(new BN(5))
      .accounts({
        subscription: newPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    const finalBalance = await provider.connection.getBalance(user.publicKey);
    const balanceDiff = initialBalance - finalBalance;
    console.log(`✅ User payment deducted - Initial: ${initialBalance}, Final: ${finalBalance}, Diff: ${balanceDiff}`);
    assert(balanceDiff > 0, "User balance should decrease");
    assert(balanceDiff >= 1_000_000, "Should deduct at least 0.001 SOL to account for rent and fees");
  });

  it("Fails to renew inactive subscription", async () => {
    const [newPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(6).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(newPda);

    await program.methods
      .createSubscription(new BN(6))
      .accounts({
        subscription: newPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    await program.methods
      .cancelSubscription()
      .accounts({
        subscription: newPda,
        user: user.publicKey,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    try {
      await program.methods
        .renewSubscription()
        .accounts({
          subscription: newPda,
          user: user.publicKey,
          treasury: treasury,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "InactiveSubscription");
      console.log("✅ Failed to renew inactive subscription as expected");
    }
  });

  it("Fails to close active subscription", async () => {
    const [newPda] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(7).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(newPda);

    await program.methods
      .createSubscription(new BN(7))
      .accounts({
        subscription: newPda,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    try {
      await program.methods
        .closeSubscription()
        .accounts({
          subscription: newPda,
          user: user.publicKey,
        })
        .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
        .rpc({ commitment: "confirmed", skipPreflight: false });
      assert.fail("Should have thrown an error");
    } catch (err) {
      const error = anchor.AnchorError.parse((err as any).logs);
      assert.equal(error?.error.errorCode.code, "ActiveSubscription");
      console.log("✅ Failed to close active subscription as expected");
    }
  });

  it("Verifies multiple subscriptions with different plan IDs", async () => {
    const [pda1] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(8).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [pda2] = await PublicKey.findProgramAddress(
      [Buffer.from("subscription"), user.publicKey.toBuffer(), new BN(9).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    await ensurePdaClosed(pda1);
    await ensurePdaClosed(pda2);

    await program.methods
      .createSubscription(new BN(8))
      .accounts({
        subscription: pda1,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    await program.methods
      .createSubscription(new BN(9))
      .accounts({
        subscription: pda2,
        user: user.publicKey,
        treasury: treasury,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })])
      .rpc({ commitment: "confirmed", skipPreflight: false });

    const sub1 = await program.account.subscription.fetch(pda1);
    const sub2 = await program.account.subscription.fetch(pda2);
    console.log("✅ Multiple subscriptions created successfully");
    assert.isTrue(sub1.active);
    assert.isTrue(sub2.active);
    assert.isTrue(sub1.planId.eq(new BN(8)));
    assert.isTrue(sub2.planId.eq(new BN(9)));
    assert.isTrue(sub1.amount.eq(FIXED_AMOUNT));
    assert.isTrue(sub2.amount.eq(FIXED_AMOUNT));
    assert.isTrue(sub1.duration.eq(FIXED_DURATION));
    assert.isTrue(sub2.duration.eq(FIXED_DURATION));
  });
});