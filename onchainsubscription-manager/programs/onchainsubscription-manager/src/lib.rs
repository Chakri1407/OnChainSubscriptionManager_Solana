use anchor_lang::prelude::*;

declare_id!("BE8PNroWQBpof1qctnwzftcFKRRVuqbYQ5Xv1LnREQBc"); // Replace with your program ID

#[program]
pub mod On_chain_subscription_manager {
    use super::*;

    // Initialize a new subscription with initial payment
    pub fn create_subscription(
        ctx: Context<CreateSubscription>,
        plan_id: u64,
        duration: u64, // Duration in seconds
        amount: u64,   // Amount in lamports
    ) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let current_time = Clock::get()?.unix_timestamp;

        // Set subscription data
        subscription.user = *ctx.accounts.user.key;
        subscription.plan_id = plan_id;
        subscription.start_time = current_time;
        subscription.duration = duration;
        subscription.amount = amount;
        subscription.active = true;
        subscription.history = vec![current_time]; // Initial payment timestamp

        // Transfer initial payment to treasury
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.user.key,
            &ctx.accounts.treasury.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
            ],
        )?;

        Ok(())
    }

    // Update subscription (e.g., extend duration or change amount)
    pub fn update_subscription(
        ctx: Context<UpdateSubscription>,
        new_duration: u64,
        new_amount: u64,
    ) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(subscription.active, SubscriptionError::InactiveSubscription);
        subscription.duration = new_duration;
        subscription.amount = new_amount;
        Ok(())
    }

    // Renew subscription with payment
    pub fn renew_subscription(ctx: Context<RenewSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(subscription.active, SubscriptionError::InactiveSubscription);

        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= subscription.start_time + subscription.duration as i64,
            SubscriptionError::NotYetExpired
        );

        // Transfer renewal payment to treasury
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            ctx.accounts.user.key,
            &ctx.accounts.treasury.key(),
            subscription.amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
            ],
        )?;

        // Update subscription state
        subscription.start_time = current_time;
        subscription.history.push(current_time); // Log renewal timestamp

        Ok(())
    }

    // Cancel subscription
    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(subscription.active, SubscriptionError::InactiveSubscription);
        subscription.active = false;
        Ok(())
    }

    // Optional: Close subscription and reclaim rent
    pub fn close_subscription(ctx: Context<CloseSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(!subscription.active, SubscriptionError::ActiveSubscription);
        Ok(())
    }
}

// Account structs
#[account]
pub struct Subscription {
    pub user: Pubkey,         // User who owns the subscription
    pub plan_id: u64,         // Identifier for the subscription plan
    pub start_time: i64,      // Unix timestamp when subscription started or last renewed
    pub duration: u64,        // Duration in seconds
    pub amount: u64,          // Amount in lamports
    pub active: bool,         // Whether the subscription is active
    pub history: Vec<i64>,    // Timestamps of payments/renewals
}

// Context structs
#[derive(Accounts)]
#[instruction(plan_id: u64)]
pub struct CreateSubscription<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 12, // 85 bytes for one history entry
        seeds = [b"subscription", user.key().as_ref(), plan_id.to_le_bytes().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: This is a treasury account controlled by the program, only used as a payment destination
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSubscription<'info> {
    #[account(
        mut,
        has_one = user @ SubscriptionError::Unauthorized
    )]
    pub subscription: Account<'info, Subscription>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct RenewSubscription<'info> {
    #[account(
        mut,
        has_one = user @ SubscriptionError::Unauthorized
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: This is a treasury account controlled by the program, only used as a payment destination
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(
        mut,
        has_one = user @ SubscriptionError::Unauthorized
    )]
    pub subscription: Account<'info, Subscription>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseSubscription<'info> {
    #[account(
        mut,
        has_one = user @ SubscriptionError::Unauthorized,
        close = user // Refund rent to user
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
}

// Custom errors
#[error_code]
pub enum SubscriptionError {
    #[msg("Subscription is not active")]
    InactiveSubscription,
    #[msg("Subscription is still active")]
    ActiveSubscription,
    #[msg("Unauthorized access to subscription")]
    Unauthorized,
    #[msg("Subscription has not yet expired")]
    NotYetExpired,
}