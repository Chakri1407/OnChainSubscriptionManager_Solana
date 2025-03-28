use anchor_lang::prelude::*;

declare_id!("5LNxghcjrSXM2BR3hKC1QinFBHx1c6rxuJfbwjRtBBVt");

#[program]
pub mod on_chain_subscription_manager {
    use super::*;

    pub fn create_subscription(
        ctx: Context<CreateSubscription>,
        plan_id: u64,
        duration: u64,
        amount: u64,
    ) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        let current_time = Clock::get()?.unix_timestamp;

        subscription.user = *ctx.accounts.user.key;
        subscription.plan_id = plan_id;
        subscription.start_time = current_time;
        subscription.duration = duration;
        subscription.amount = amount;
        subscription.active = true;
        subscription.history = vec![current_time];

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

    pub fn renew_subscription(ctx: Context<RenewSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(subscription.active, SubscriptionError::InactiveSubscription);

        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= subscription.start_time + subscription.duration as i64,
            SubscriptionError::NotYetExpired
        );

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

        // Limit history size to prevent excessive growth
        if subscription.history.len() >= 10 {
            subscription.history.remove(0); // Remove oldest entry
        }
        subscription.history.push(current_time);
        subscription.start_time = current_time;

        Ok(())
    }

    pub fn cancel_subscription(ctx: Context<CancelSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(subscription.active, SubscriptionError::InactiveSubscription);
        subscription.active = false;
        Ok(())
    }

    pub fn close_subscription(ctx: Context<CloseSubscription>) -> Result<()> {
        let subscription = &mut ctx.accounts.subscription;
        require!(!subscription.active, SubscriptionError::ActiveSubscription);
        Ok(())
    }
}

#[account]
pub struct Subscription {
    pub user: Pubkey,         // 32 bytes
    pub plan_id: u64,         // 8 bytes
    pub start_time: i64,      // 8 bytes
    pub duration: u64,        // 8 bytes
    pub amount: u64,          // 8 bytes
    pub active: bool,         // 1 byte
    pub history: Vec<i64>,    // 4 bytes (len) + 8 bytes per i64
}

#[derive(Accounts)]
#[instruction(plan_id: u64)]
pub struct CreateSubscription<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 4 + (10 * 8), // Discriminator + fields + Vec with 10 i64s
        seeds = [b"subscription", user.key().as_ref(), plan_id.to_le_bytes().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: Treasury account controlled by the program
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSubscription<'info> {
    #[account(mut, has_one = user @ SubscriptionError::Unauthorized)]
    pub subscription: Account<'info, Subscription>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct RenewSubscription<'info> {
    #[account(mut, has_one = user @ SubscriptionError::Unauthorized)]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: Treasury account controlled by the program
    #[account(mut)]
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelSubscription<'info> {
    #[account(mut, has_one = user @ SubscriptionError::Unauthorized)]
    pub subscription: Account<'info, Subscription>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseSubscription<'info> {
    #[account(mut, has_one = user @ SubscriptionError::Unauthorized, close = user)]
    pub subscription: Account<'info, Subscription>,
    #[account(mut)]
    pub user: Signer<'info>,
}

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