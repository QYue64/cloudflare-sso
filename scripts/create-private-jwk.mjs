import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.alg = "ES256";
jwk.use = "sig";
jwk.kid = crypto.randomUUID();

console.log(JSON.stringify(jwk));
