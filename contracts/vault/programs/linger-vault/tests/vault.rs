//! Kasa testleri — litesvm ile gercek `.so` uzerinde calisir.
//!
//! Once `anchor build` gerekir; testler `target/deploy/linger_vault.so`
//! dosyasini yukler.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    linger_vault::{Balance, BALANCE_SEED, CONFIG_SEED, VAULT_SEED},
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const TOKEN_PROGRAM: Pubkey = anchor_spl::token::ID;
/// USDC: 6 ondalik. 1 USDC = 1_000_000.
const USDC: u64 = 1_000_000;

/* ── test ortami ── */

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    admin: Keypair,
    mint: Pubkey,
    platform_token: Pubkey,
    config: Pubkey,
    vault: Pubkey,
}

struct Advertiser {
    key: Keypair,
    token: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &linger_vault::id()).0
}

fn balance_pda(advertiser: &Pubkey) -> Pubkey {
    pda(&[BALANCE_SEED, advertiser.as_ref()])
}

fn put(svm: &mut LiteSVM, address: Pubkey, data: Vec<u8>, owner: Pubkey) {
    svm.set_account(
        address,
        Account { lamports: 10_000_000, data, owner, executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

fn mint_bytes() -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&0u32.to_le_bytes()); // mint_authority: None
    d[44] = 6; // decimals
    d[45] = 1; // is_initialized
    d
}

fn token_account_bytes(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // AccountState::Initialized
    d
}

fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let data = svm.get_account(account).expect("token hesabi yok").data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn ledger_balance(svm: &LiteSVM, advertiser: &Pubkey) -> u64 {
    match svm.get_account(&balance_pda(advertiser)) {
        Some(a) if !a.data.is_empty() => Balance::try_deserialize(&mut a.data.as_slice()).unwrap().amount,
        _ => 0,
    }
}

fn new_token_account(env: &mut Env, owner: &Pubkey, amount: u64) -> Pubkey {
    let address = Pubkey::new_unique();
    put(&mut env.svm, address, token_account_bytes(&env.mint, owner, amount), TOKEN_PROGRAM);
    address
}

fn new_advertiser(env: &mut Env, funded: u64) -> Advertiser {
    let key = Keypair::new();
    env.svm.airdrop(&key.pubkey(), 1_000_000_000).unwrap();
    let token = new_token_account(env, &key.pubkey(), funded);
    Advertiser { key, token }
}

/// `initialize` cagrilmis, `bps` ile kurulmus ortam.
fn setup_with(bps: u16) -> (Env, Result<(), FailedTransactionMetadata>) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/linger_vault.so"));
    svm.add_program(linger_vault::id(), bytes).unwrap();

    let payer = Keypair::new();
    let admin = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();

    let mint = Pubkey::new_unique();
    put(&mut svm, mint, mint_bytes(), TOKEN_PROGRAM);
    let platform_owner = Pubkey::new_unique();
    let platform_token = Pubkey::new_unique();
    put(&mut svm, platform_token, token_account_bytes(&mint, &platform_owner, 0), TOKEN_PROGRAM);

    let mut env = Env {
        svm,
        payer,
        admin,
        mint,
        platform_token,
        config: pda(&[CONFIG_SEED]),
        vault: pda(&[VAULT_SEED]),
    };

    let ix = Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Initialize { publisher_bps: bps }.data(),
        linger_vault::accounts::Initialize {
            payer: env.payer.pubkey(),
            admin: env.admin.pubkey(),
            mint: env.mint,
            platform_token: env.platform_token,
            config: env.config,
            vault: env.vault,
            token_program: TOKEN_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let payer = Keypair::new_from_bytes(&env.payer);
    let res = send(&mut env.svm, &[ix], &payer, &[]);
    (env, res)
}

fn setup(bps: u16) -> Env {
    let (env, res) = setup_with(bps);
    res.expect("initialize basarisiz");
    env
}

trait CloneKey {
    fn new_from_bytes(k: &Keypair) -> Keypair;
}
impl CloneKey for Keypair {
    fn new_from_bytes(k: &Keypair) -> Keypair {
        Keypair::try_from(k.to_bytes().as_slice()).unwrap()
    }
}

fn send(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    payer: &Keypair,
    extra: &[&Keypair],
) -> Result<(), FailedTransactionMetadata> {
    // Ayni blockhash ile ayni transaction ikinci kez gonderilirse "zaten
    // islendi" der; testler ayni cagriyi tekrarlayabilsin diye.
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx).map(|_| ())
}

fn deposit_ix(env: &Env, adv: &Advertiser, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Deposit { amount }.data(),
        linger_vault::accounts::Deposit {
            advertiser: adv.key.pubkey(),
            config: env.config,
            mint: env.mint,
            advertiser_token: adv.token,
            vault: env.vault,
            balance: balance_pda(&adv.key.pubkey()),
            token_program: TOKEN_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw_ix(env: &Env, adv: &Advertiser, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Withdraw { amount }.data(),
        linger_vault::accounts::Withdraw {
            advertiser: adv.key.pubkey(),
            config: env.config,
            mint: env.mint,
            advertiser_token: adv.token,
            vault: env.vault,
            balance: balance_pda(&adv.key.pubkey()),
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    )
}

fn release_ix(env: &Env, admin: &Pubkey, advertiser: &Pubkey, publisher_token: &Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Release { amount }.data(),
        linger_vault::accounts::Release {
            admin: *admin,
            config: env.config,
            mint: env.mint,
            advertiser: *advertiser,
            balance: balance_pda(advertiser),
            vault: env.vault,
            publisher_token: *publisher_token,
            platform_token: env.platform_token,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    )
}

fn do_deposit(env: &mut Env, adv: &Advertiser, amount: u64) -> Result<(), FailedTransactionMetadata> {
    let ix = deposit_ix(env, adv, amount);
    send(&mut env.svm, &[ix], &Keypair::new_from_bytes(&adv.key), &[])
}

fn do_withdraw(env: &mut Env, adv: &Advertiser, amount: u64) -> Result<(), FailedTransactionMetadata> {
    let ix = withdraw_ix(env, adv, amount);
    send(&mut env.svm, &[ix], &Keypair::new_from_bytes(&adv.key), &[])
}

fn do_release(env: &mut Env, adv: &Pubkey, publisher_token: &Pubkey, amount: u64) -> Result<(), FailedTransactionMetadata> {
    let ix = release_ix(env, &env.admin.pubkey(), adv, publisher_token, amount);
    let admin = Keypair::new_from_bytes(&env.admin);
    let payer = Keypair::new_from_bytes(&env.payer);
    send(&mut env.svm, &[ix], &payer, &[&admin])
}

/// Basarisiz transaction'in log'unda beklenen Anchor hatasi var mi?
fn assert_fails_with(res: Result<(), FailedTransactionMetadata>, code: &str) {
    let err = res.expect_err("basarisiz olmaliydi");
    let logs = err.meta.logs.join("\n");
    assert!(logs.contains(code), "beklenen hata `{code}` log'da yok:\n{logs}");
}

/// Kasa token bakiyesi >= butun `Balance` kayitlarinin toplami.
fn assert_solvent(env: &Env, advertisers: &[&Advertiser]) {
    let owed: u64 = advertisers.iter().map(|a| ledger_balance(&env.svm, &a.key.pubkey())).sum();
    let vault = token_amount(&env.svm, &env.vault);
    assert!(vault >= owed, "kasa borclu: kasada {vault}, borc {owed}");
}

/* ── testler ── */

#[test]
fn deposit_yatan_parayi_kasaya_tasir_ve_bakiyeyi_arttirir() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);

    do_deposit(&mut env, &adv, 40 * USDC).unwrap();

    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 40 * USDC);
    assert_eq!(token_amount(&env.svm, &env.vault), 40 * USDC);
    assert_eq!(token_amount(&env.svm, &adv.token), 60 * USDC);

    do_deposit(&mut env, &adv, 10 * USDC).unwrap();
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 50 * USDC);
    assert_solvent(&env, &[&adv]);
}

#[test]
fn withdraw_reklamveren_harcanmamis_bakiyesini_geri_alir() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    do_deposit(&mut env, &adv, 100 * USDC).unwrap();

    // Admin hicbir sey imzalamadi: reklamveren kendi basina cekebiliyor.
    do_withdraw(&mut env, &adv, 30 * USDC).unwrap();

    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 70 * USDC);
    assert_eq!(token_amount(&env.svm, &adv.token), 30 * USDC);
    assert_eq!(token_amount(&env.svm, &env.vault), 70 * USDC);

    // Bakiyesinin ustunu cekemez.
    assert_fails_with(do_withdraw(&mut env, &adv, 71 * USDC), "InsufficientBalance");
}

#[test]
fn withdraw_reklamverenin_kendi_imzasi_gerekir() {
    let mut env = setup(5000);
    let victim = new_advertiser(&mut env, 100 * USDC);
    do_deposit(&mut env, &victim, 100 * USDC).unwrap();

    // Saldirgan kendi imzasiyla, kurbanin bakiyesini ve token hesabini
    // gostererek cekmeye calisir.
    let attacker = new_advertiser(&mut env, 0);
    let ix = Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Withdraw { amount: 10 * USDC }.data(),
        linger_vault::accounts::Withdraw {
            advertiser: attacker.key.pubkey(),
            config: env.config,
            mint: env.mint,
            advertiser_token: attacker.token,
            vault: env.vault,
            balance: balance_pda(&victim.key.pubkey()),
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    );
    let res = send(&mut env.svm, &[ix], &Keypair::new_from_bytes(&attacker.key), &[]);
    assert!(res.is_err(), "baskasinin bakiyesi cekilememeliydi");

    // Kurbanin token hesabini gosterip kendi imzasiyla da olmaz.
    let ix = Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Withdraw { amount: 10 * USDC }.data(),
        linger_vault::accounts::Withdraw {
            advertiser: attacker.key.pubkey(),
            config: env.config,
            mint: env.mint,
            advertiser_token: victim.token,
            vault: env.vault,
            balance: balance_pda(&attacker.key.pubkey()),
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None),
    );
    let res = send(&mut env.svm, &[ix], &Keypair::new_from_bytes(&attacker.key), &[]);
    assert!(res.is_err(), "baskasinin token hesabina cekilememeliydi");

    assert_eq!(ledger_balance(&env.svm, &victim.key.pubkey()), 100 * USDC);
    assert_eq!(token_amount(&env.svm, &env.vault), 100 * USDC);
}

#[test]
fn release_payi_boler_yayinciya_ve_platforma_ayni_anda_gonderir() {
    let mut env = setup(7000); // %70 yayinci
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 100 * USDC).unwrap();

    do_release(&mut env, &adv.key.pubkey(), &publisher, 10 * USDC).unwrap();

    assert_eq!(token_amount(&env.svm, &publisher), 7 * USDC);
    assert_eq!(token_amount(&env.svm, &env.platform_token), 3 * USDC);
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 90 * USDC);
    assert_eq!(token_amount(&env.svm, &env.vault), 90 * USDC);
    assert_solvent(&env, &[&adv]);
}

#[test]
fn release_yuz_bps_yayinciya_hicbir_sey_platforma_gitmez() {
    let mut env = setup(10_000);
    let adv = new_advertiser(&mut env, 50 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 50 * USDC).unwrap();

    do_release(&mut env, &adv.key.pubkey(), &publisher, 50 * USDC).unwrap();

    assert_eq!(token_amount(&env.svm, &publisher), 50 * USDC);
    assert_eq!(token_amount(&env.svm, &env.platform_token), 0);
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 0);
}

#[test]
fn release_sifir_bps_hicbir_sey_yayinciya_gitmez() {
    let mut env = setup(0);
    let adv = new_advertiser(&mut env, 50 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 50 * USDC).unwrap();

    do_release(&mut env, &adv.key.pubkey(), &publisher, 50 * USDC).unwrap();

    assert_eq!(token_amount(&env.svm, &publisher), 0);
    assert_eq!(token_amount(&env.svm, &env.platform_token), 50 * USDC);
}

#[test]
fn release_yuvarlama_artigi_platformda_kalir() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 10);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 10).unwrap();

    // 3 * 5000 / 10000 = 1 (asagi); kalan 2 platformda.
    do_release(&mut env, &adv.key.pubkey(), &publisher, 3).unwrap();

    assert_eq!(token_amount(&env.svm, &publisher), 1);
    assert_eq!(token_amount(&env.svm, &env.platform_token), 2);
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 7);
    assert_solvent(&env, &[&adv]);
}

#[test]
fn release_bakiyenin_ustunde_istenirse_basarisiz_olur() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 10 * USDC).unwrap();

    assert_fails_with(
        do_release(&mut env, &adv.key.pubkey(), &publisher, 10 * USDC + 1),
        "InsufficientBalance",
    );
    assert_eq!(token_amount(&env.svm, &publisher), 0);
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 10 * USDC);
}

#[test]
fn release_admin_disinda_kimse_cagiramaz() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 100 * USDC).unwrap();

    // Reklamverenin kendisi bile admin degil.
    let ix = release_ix(&env, &adv.key.pubkey(), &adv.key.pubkey(), &publisher, 10 * USDC);
    let res = send(&mut env.svm, &[ix], &Keypair::new_from_bytes(&adv.key), &[]);
    assert_fails_with(res, "Unauthorized");

    // Rastgele bir anahtar da degil.
    let rogue = Keypair::new();
    env.svm.airdrop(&rogue.pubkey(), 1_000_000_000).unwrap();
    let ix = release_ix(&env, &rogue.pubkey(), &adv.key.pubkey(), &publisher, 10 * USDC);
    assert_fails_with(send(&mut env.svm, &[ix], &rogue, &[]), "Unauthorized");

    assert_eq!(token_amount(&env.svm, &publisher), 0);
    assert_eq!(ledger_balance(&env.svm, &adv.key.pubkey()), 100 * USDC);
}

#[test]
fn release_platform_hesabi_disina_platform_payi_gonderilemez() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    let rogue_platform = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 100 * USDC).unwrap();

    // Admin bile platform payini baska bir hesaba yonlendiremez.
    let mut ix = release_ix(&env, &env.admin.pubkey(), &adv.key.pubkey(), &publisher, 10 * USDC);
    let platform_idx = ix.accounts.iter().position(|m| m.pubkey == env.platform_token).unwrap();
    ix.accounts[platform_idx].pubkey = rogue_platform;
    let admin = Keypair::new_from_bytes(&env.admin);
    let payer = Keypair::new_from_bytes(&env.payer);
    assert_fails_with(send(&mut env.svm, &[ix], &payer, &[&admin]), "InvalidDestination");
    assert_eq!(token_amount(&env.svm, &rogue_platform), 0);
}

#[test]
fn cifte_release_ayni_parayi_iki_kez_odemez() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 100 * USDC).unwrap();

    do_release(&mut env, &adv.key.pubkey(), &publisher, 100 * USDC).unwrap();
    // Bakiye sifirlandi; ayni cagri tekrarlanirsa ikinci kez odenmez.
    assert_fails_with(
        do_release(&mut env, &adv.key.pubkey(), &publisher, 100 * USDC),
        "InsufficientBalance",
    );

    assert_eq!(token_amount(&env.svm, &publisher), 50 * USDC);
    assert_eq!(token_amount(&env.svm, &env.platform_token), 50 * USDC);
    assert_eq!(token_amount(&env.svm, &env.vault), 0);
}

#[test]
fn sifir_tutar_reddedilir() {
    let mut env = setup(5000);
    let adv = new_advertiser(&mut env, 100 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);
    do_deposit(&mut env, &adv, 10 * USDC).unwrap();

    assert_fails_with(do_deposit(&mut env, &adv, 0), "AmountNotPositive");
    assert_fails_with(do_withdraw(&mut env, &adv, 0), "AmountNotPositive");
    assert_fails_with(do_release(&mut env, &adv.key.pubkey(), &publisher, 0), "AmountNotPositive");
}

#[test]
fn gecersiz_bps_ile_initialize_reddedilir() {
    let (_, res) = setup_with(10_001);
    assert_fails_with(res, "InvalidBps");

    // Sinir degerleri kabul edilir.
    let (_, res) = setup_with(0);
    assert!(res.is_ok());
    let (_, res) = setup_with(10_000);
    assert!(res.is_ok());
}

#[test]
fn initialize_ikinci_kez_cagrilamaz() {
    let mut env = setup(5000);

    // Saldirgan admin'i degistirmek icin tekrar initialize etmeye calisir.
    let attacker = Keypair::new();
    env.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let ix = Instruction::new_with_bytes(
        linger_vault::id(),
        &linger_vault::instruction::Initialize { publisher_bps: 0 }.data(),
        linger_vault::accounts::Initialize {
            payer: attacker.pubkey(),
            admin: attacker.pubkey(),
            mint: env.mint,
            platform_token: env.platform_token,
            config: env.config,
            vault: env.vault,
            token_program: TOKEN_PROGRAM,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut env.svm, &[ix], &attacker, &[]).is_err());
}

#[test]
fn solvency_invariant_karisik_islemler_sonrasi_da_saglam() {
    let mut env = setup(6000);
    let a = new_advertiser(&mut env, 1_000 * USDC);
    let b = new_advertiser(&mut env, 1_000 * USDC);
    let publisher = new_token_account(&mut env, &Pubkey::new_unique(), 0);

    do_deposit(&mut env, &a, 500 * USDC).unwrap();
    assert_solvent(&env, &[&a, &b]);
    do_deposit(&mut env, &b, 333_333).unwrap();
    assert_solvent(&env, &[&a, &b]);
    do_release(&mut env, &a.key.pubkey(), &publisher, 123_457).unwrap();
    assert_solvent(&env, &[&a, &b]);
    do_withdraw(&mut env, &b, 100_000).unwrap();
    assert_solvent(&env, &[&a, &b]);
    do_release(&mut env, &b.key.pubkey(), &publisher, 233_333).unwrap();
    assert_solvent(&env, &[&a, &b]);
    do_deposit(&mut env, &a, 7).unwrap();
    do_withdraw(&mut env, &a, 400 * USDC).unwrap();
    assert_solvent(&env, &[&a, &b]);

    // Basarisiz denemeler de bakiyeyi bozmaz.
    let _ = do_release(&mut env, &b.key.pubkey(), &publisher, 10 * USDC);
    let _ = do_withdraw(&mut env, &b, 10 * USDC);
    assert_solvent(&env, &[&a, &b]);

    // Kasa disaridan bagis alirsa (bakiye kaydi olmadan) hala >= borc.
    let vault = env.vault;
    let mut acc = env.svm.get_account(&vault).unwrap();
    let cur = u64::from_le_bytes(acc.data[64..72].try_into().unwrap());
    acc.data[64..72].copy_from_slice(&(cur + 42).to_le_bytes());
    env.svm.set_account(vault, acc).unwrap();
    assert_solvent(&env, &[&a, &b]);

    // Para korunumu: kasa + yayinci + platform + reklamveren cepleri sabit.
    let total = token_amount(&env.svm, &env.vault)
        + token_amount(&env.svm, &publisher)
        + token_amount(&env.svm, &env.platform_token)
        + token_amount(&env.svm, &a.token)
        + token_amount(&env.svm, &b.token);
    assert_eq!(total, 1_000 * USDC * 2 + 42);
}
