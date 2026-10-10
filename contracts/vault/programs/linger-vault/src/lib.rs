//! Linger reklamveren emanet kasasi.
//!
//! Reklamverenin USDC'si tek bir opak sicak cuzdanda toplanmak yerine bu
//! programda, reklamveren bazinda ayristirilmis olarak duruyor. Herkes
//! `Balance` hesabini zincirden okuyarak dogrulayabilir; kasanin kendi token
//! bakiyesi her zaman butun `Balance` kayitlarinin toplamina esit ya da
//! buyuk olmak ZORUNDA — bu, testlerde bir invariant olarak korunuyor.
//!
//! `release` disinda hicbir yol parayi disari cikaramaz: reklamveren
//! `withdraw` ile harcanmamis bakiyesini PLATFORMDAN IZIN ISTEMEDEN, sunucu
//! kapali olsa bile geri alabilir.
//!
//! `release` payi kendi icinde boler — yayinciya `publisher_bps`, kalani
//! (yuvarlama artigi dahil) platformun token hesabina, AYNI transaction'da,
//! iki ayri transfer olarak. Platform payi HER release'de ANINDA platformun
//! kendi hesabina duser; ayri bir "biriken payi cek" akisina gerek yok.
//!
//! `publisher_bps` `initialize` aninda sabitlenir, sonradan DEGISTIRILEMEZ:
//! `release` icinde bps'i disaridan parametre olarak kabul etseydik,
//! ele gecirilmis bir admin anahtari yayinci payini sifira cekip butun parayi
//! platforma yonlendirebilirdi.
//!
//! Neyin DEGISMEDIGI: `release`'i imzalayan `admin` hala sunucuda duran SICAK
//! bir anahtar. Bu program imza-custody riskini sifirlamiyor — hesap
//! sorulabilirligi (kimin ne kadar hakki oldugu zincirde dogrulanabilir)
//! kazandiriyor, "admin anahtari calinamaz" garantisi vermiyor.
//!
//! Deploy notu: `initialize` ilk cagiran kisinin admin'i belirledigi tek
//! seferlik bir islemdir. Program deploy edilir edilmez, baska biri araya
//! girmeden cagrilmalidir.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("3xRmSsG6i14rp1ddqfLP8v3qNqkWxEhG3C3qxPaNYdwA");

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BALANCE_SEED: &[u8] = b"balance";
pub const BPS_DENOMINATOR: u64 = 10_000;

#[program]
pub mod linger_vault {
    use super::*;

    /// Bir kez, deploy sonrasi. `admin` yalnizca `release` cagirabilir —
    /// reklamverenin kendi parasini `withdraw` ile cekmesini ENGELLEYEMEZ.
    /// `publisher_bps` 0..=10000 olmak zorunda ve sonradan DEGISTIRILEMEZ.
    pub fn initialize(ctx: Context<Initialize>, publisher_bps: u16) -> Result<()> {
        require!(
            u64::from(publisher_bps) <= BPS_DENOMINATOR,
            VaultError::InvalidBps
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.mint = ctx.accounts.mint.key();
        config.platform_token = ctx.accounts.platform_token.key();
        config.publisher_bps = publisher_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Reklamveren kendi USDC'sini kasaya yatirir. Kendi imzasi sart —
    /// admin ya da baska biri baskasi adina yatiramaz.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::AmountNotPositive);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.advertiser_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.advertiser.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let balance = &mut ctx.accounts.balance;
        balance.advertiser = ctx.accounts.advertiser.key();
        balance.bump = ctx.bumps.balance;
        balance.amount = balance
            .amount
            .checked_add(amount)
            .ok_or(VaultError::Overflow)?;

        emit!(Deposited {
            advertiser: balance.advertiser,
            amount,
            new_balance: balance.amount,
        });
        Ok(())
    }

    /// Yalnizca admin — dogrulanmis gosterim batch'i sonrasi, kasadan
    /// yayinciya VE platforma AYNI ANDA oder. Reklamverenin bakiyesinden
    /// `amount`'un TAMAMI duser; `publisher_bps` payi yayinciya, kalani
    /// (yuvarlama artigi dahil) platforma gider.
    pub fn release(ctx: Context<Release>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::AmountNotPositive);

        // Once defter, sonra transfer: bir CPI patlarsa transaction'in tamami
        // geri alinir, ama sira yine de "kaydi dus, sonra parayi gonder".
        let balance = &mut ctx.accounts.balance;
        require!(balance.amount >= amount, VaultError::InsufficientBalance);
        balance.amount -= amount;

        // Formul: publisher = amount * bps / 10000 (asagi yuvarlanir),
        // platform = amount - publisher (artik platformda).
        let publisher_amount = u64::try_from(
            u128::from(amount) * u128::from(ctx.accounts.config.publisher_bps)
                / u128::from(BPS_DENOMINATOR),
        )
        .map_err(|_| VaultError::Overflow)?;
        let platform_amount = amount - publisher_amount;

        let decimals = ctx.accounts.mint.decimals;
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];

        if publisher_amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.publisher_token.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer_seeds,
                ),
                publisher_amount,
                decimals,
            )?;
        }
        if platform_amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.platform_token.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer_seeds,
                ),
                platform_amount,
                decimals,
            )?;
        }

        emit!(Released {
            advertiser: ctx.accounts.balance.advertiser,
            publisher_token: ctx.accounts.publisher_token.key(),
            amount,
            publisher_amount,
            new_balance: ctx.accounts.balance.amount,
        });
        Ok(())
    }

    /// Reklamveren harcanmamis bakiyesini geri ceker — platformun onayina
    /// gerek YOK. Sunucu kapali olsa bile bu cagri calisir.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::AmountNotPositive);

        let balance = &mut ctx.accounts.balance;
        require!(balance.amount >= amount, VaultError::InsufficientBalance);
        balance.amount -= amount;

        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.advertiser_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Withdrawn {
            advertiser: ctx.accounts.advertiser.key(),
            amount,
            new_balance: ctx.accounts.balance.amount,
        });
        Ok(())
    }
}

/* ── hesaplar ── */

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Yalnizca `release` cagirabilir.
    pub admin: Pubkey,
    /// Odeme birimi (USDC). Sabit.
    pub mint: Pubkey,
    /// Platform payinin gittigi token hesabi.
    pub platform_token: Pubkey,
    /// Yayinci payi, baz puan (5000 = %50). `initialize`'da sabitlenir.
    pub publisher_bps: u16,
    pub bump: u8,
}

/// Reklamverenin kasadaki harcanmamis bakiyesi.
#[account]
#[derive(InitSpace)]
pub struct Balance {
    pub advertiser: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: yalnizca adresi saklanir; `release` icin imzalayacak anahtar.
    pub admin: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(token::mint = mint)]
    pub platform_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Kasa: token hesabinin sahibi `config` PDA'sidir, yani parayi yalnizca
    /// bu program imzalayabilir.
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = advertiser,
        token::token_program = token_program,
    )]
    pub advertiser_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [VAULT_SEED], bump, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = advertiser,
        space = 8 + Balance::INIT_SPACE,
        seeds = [BALANCE_SEED, advertiser.key().as_ref()],
        bump,
    )]
    pub balance: Account<'info, Balance>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub advertiser: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = advertiser,
        token::token_program = token_program,
    )]
    pub advertiser_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [VAULT_SEED], bump, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [BALANCE_SEED, advertiser.key().as_ref()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, Balance>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    /// Yalnizca `config.admin`.
    #[account(address = config.admin @ VaultError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: yalnizca `balance` PDA'sinin tohumu; imza gerekmez.
    pub advertiser: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [BALANCE_SEED, advertiser.key().as_ref()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, Balance>,

    #[account(mut, seeds = [VAULT_SEED], bump, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Yayincinin USDC hesabi. Kasanin kendisi olamaz.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = publisher_token.key() != vault.key() @ VaultError::InvalidDestination,
    )]
    pub publisher_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        address = config.platform_token @ VaultError::InvalidDestination,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub platform_token: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/* ── olaylar ── */

#[event]
pub struct Deposited {
    pub advertiser: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct Released {
    pub advertiser: Pubkey,
    pub publisher_token: Pubkey,
    /// Reklamverenin bakiyesinden dusen TOPLAM tutar.
    pub amount: u64,
    /// Bunun ne kadari yayinciya gitti — kalani (yuvarlama artigi dahil)
    /// platforma gitti (`amount - publisher_amount`).
    pub publisher_amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct Withdrawn {
    pub advertiser: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

/* ── hatalar ── */

#[error_code]
pub enum VaultError {
    #[msg("Tutar sifirdan buyuk olmali")]
    AmountNotPositive,
    #[msg("Reklamverenin kasadaki bakiyesi yetersiz")]
    InsufficientBalance,
    #[msg("publisher_bps 0..=10000 araliginda olmali")]
    InvalidBps,
    #[msg("Bu islemi yalnizca admin yapabilir")]
    Unauthorized,
    #[msg("Gecersiz hedef hesap")]
    InvalidDestination,
    #[msg("Aritmetik tasma")]
    Overflow,
}
