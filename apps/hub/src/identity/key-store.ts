import * as jose from "jose";
import { auditLogger } from "./audit-logger.js";

export interface KeyEntry {
  kid: string;
  keyPair: jose.GenerateKeyPairResult;
  status: "active" | "grace_period" | "retired";
  createdAt: number; // Unix timestamp in seconds
  expiresAt?: number; // Optional expiration for grace period
}

export class KeyStore {
  private static instance: KeyStore;
  private keys: Map<string, KeyEntry> = new Map();
  private currentKid: string = "";
  private keyCounter: number = 1;

  public static getInstance(): KeyStore {
    if (!KeyStore.instance) {
      KeyStore.instance = new KeyStore();
    }
    return KeyStore.instance;
  }

  /**
   * Initializes the primary signing key if none exists.
   */
  public async initialize(): Promise<void> {
    if (this.keys.size === 0) {
      const kid = `cs-hub-key-v${this.keyCounter}`;
      const keyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
      this.keys.set(kid, {
        kid,
        keyPair,
        status: "active",
        createdAt: Math.floor(Date.now() / 1000)
      });
      this.currentKid = kid;
    }
  }

  /**
   * Returns current active signing key and kid.
   */
  public async getSigningKey(): Promise<{ kid: string; keyPair: jose.GenerateKeyPairResult }> {
    await this.initialize();
    const entry = this.keys.get(this.currentKid);
    if (!entry || entry.status !== "active") {
      throw new Error(`Active signing key ${this.currentKid} not found or inactive`);
    }
    return { kid: entry.kid, keyPair: entry.keyPair };
  }

  /**
   * Retrieves public verification key by kid, accepting active or grace-period keys.
   */
  public async getVerificationKey(kid: string): Promise<jose.KeyLike> {
    await this.initialize();
    const entry = this.keys.get(kid);
    if (!entry) {
      throw new Error(`Key ID '${kid}' not found in key store`);
    }
    if (entry.status === "retired") {
      throw new Error(`Key ID '${kid}' is retired and cannot be used for verification`);
    }
    return entry.keyPair.publicKey;
  }

  /**
   * Rotates the signing key:
   * 1. Marks current active key as 'grace_period' (accepted for existing tokens).
   * 2. Generates new active key and sets as new current signing key.
   */
  public async rotateKey(gracePeriodSeconds: number = 86400): Promise<{ oldKid: string; newKid: string }> {
    await this.initialize();
    const oldKid = this.currentKid;
    const oldEntry = this.keys.get(oldKid);
    const now = Math.floor(Date.now() / 1000);

    if (oldEntry) {
      oldEntry.status = "grace_period";
      oldEntry.expiresAt = now + gracePeriodSeconds;
    }

    this.keyCounter += 1;
    const newKid = `cs-hub-key-v${this.keyCounter}`;
    const newKeyPair = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });

    this.keys.set(newKid, {
      kid: newKid,
      keyPair: newKeyPair,
      status: "active",
      createdAt: now
    });
    this.currentKid = newKid;

    auditLogger.log({
      event_type: "KEY_ROTATION",
      reason: `Rotated signing key from ${oldKid} to ${newKid}`
    });

    return { oldKid, newKid };
  }

  /**
   * Explicitly retires an old key ID so it can no longer verify tokens.
   */
  public retireKey(kid: string): void {
    const entry = this.keys.get(kid);
    if (entry) {
      entry.status = "retired";
    }
  }

  /**
   * Exports public JWKS set for active and grace-period keys.
   */
  public async getPublicJWKS(): Promise<{ keys: jose.JWK[] }> {
    await this.initialize();
    const jwks: jose.JWK[] = [];

    for (const [kid, entry] of this.keys.entries()) {
      if (entry.status === "active" || entry.status === "grace_period") {
        const publicJwk = await jose.exportJWK(entry.keyPair.publicKey);
        publicJwk.kid = kid;
        publicJwk.alg = "EdDSA";
        publicJwk.use = "sig";
        jwks.push(publicJwk);
      }
    }

    return { keys: jwks };
  }

  /**
   * Reset store (useful for clean test isolation).
   */
  public reset(): void {
    this.keys.clear();
    this.currentKid = "";
    this.keyCounter = 1;
  }
}

export const keyStore = KeyStore.getInstance();
