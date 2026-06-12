export default {
  providers: [
    {
      // Clerk Frontend API URL (issuer). Set in the Convex dashboard env as CLERK_JWT_ISSUER_DOMAIN.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
