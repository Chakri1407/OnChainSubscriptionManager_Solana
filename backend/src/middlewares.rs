use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage,
};
use futures_util::future::LocalBoxFuture;
use std::future::{ready, Ready};
use crate::{AppError, AuthService};

pub struct Authentication {
    auth_service: AuthService,
}

impl Authentication {
    pub fn new(auth_service: AuthService) -> Self {
        Authentication { auth_service }
    }
}

impl<S, B> Transform<S, ServiceRequest> for Authentication
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = AuthenticationMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AuthenticationMiddleware {
            service,
            auth_service: self.auth_service.clone(),
        }))
    }
}

pub struct AuthenticationMiddleware<S> {
    service: S,
    auth_service: AuthService,
}

impl<S, B> Service<ServiceRequest> for AuthenticationMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let token = req.headers().get("Authorization").and_then(|header| {
            let header = header.to_str().ok()?;
            header.strip_prefix("Bearer ").map(|s| s.to_string())
        });

        let token = match token {
            Some(t) => t,
            None => return Box::pin(async { Err(AppError::Auth("No token provided".to_string()).into()) }),
        };

        let auth_service = self.auth_service.clone();

        match auth_service.verify_token(&token) {
            Ok(auth_token) => {
                let req = req; 
                req.extensions_mut().insert(auth_token);
                let fut = self.service.call(req);
                Box::pin(async move { fut.await })
            }
            Err(e) => Box::pin(async move { Err(e.into()) }),
        }
    }
}