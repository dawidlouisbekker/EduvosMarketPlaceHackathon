pub mod oidc;
pub mod routes;
pub mod session;

#[allow(unused_imports)] // MaybeUser/AdminUser are ready for future routes
pub use session::{AdminUser, AuthUser, MaybeUser};
