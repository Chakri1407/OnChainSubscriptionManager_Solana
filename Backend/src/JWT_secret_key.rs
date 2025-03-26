use rand::{Rng, thread_rng};
fn main() {
    let secret: String = thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    println!("JWT_SECRET={}", secret);
}