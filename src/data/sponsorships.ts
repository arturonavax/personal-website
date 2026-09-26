export interface CryptoAddress {
  id: string;
  name: string;
  symbol: string;
  network: string;
  networkEs: string;
  address: string;
  memo?: string;
}

export interface DirectPlatform {
  id: string;
  name: string;
  description: string;
  descriptionEs: string;
  url: string;
  badge: string;
  badgeEs: string;
  icon: "paypal" | "github";
}

export interface FutureIntegration {
  id: string;
  name: string;
  description: string;
  descriptionEs: string;
  badge: string;
  badgeEs: string;
  type: "stripe" | "web3";
  status: "planned" | "prototype";
}

export interface SponsorshipData {
  crypto: CryptoAddress[];
  platforms: DirectPlatform[];
  futureIntegrations: FutureIntegration[];
}

export const sponsorshipData: SponsorshipData = {
  crypto: [],
  platforms: [],
  futureIntegrations: [],
};

/* TODO: reactivate
export const sponsorshipData: SponsorshipData = {
  crypto: [
    {
      id: "btc",
      name: "Bitcoin",
      symbol: "BTC",
      network: "Native SegWit (Bech32)",
      networkEs: "Native SegWit (Bech32)",
      address: "bc1q9v89u2v0e883m7xzg592s38u445v9y2v929p4s",
    },
    {
      id: "eth",
      name: "Ethereum",
      symbol: "ETH / ERC-20",
      network: "Ethereum Mainnet / Arbitrum / Optimism / Base",
      networkEs: "Ethereum Mainnet / Arbitrum / Optimism / Base",
      address: "0x71C67E7aEdf2aF6Ea3B3D966E2a02b11394c8e76",
    },
    {
      id: "usdt",
      name: "Tether USD",
      symbol: "USDT",
      network: "Tron (TRC-20) / Arbitrum (ERC-20)",
      networkEs: "Tron (TRC-20) / Arbitrum (ERC-20)",
      address: "TX9rqvJmX8PsqYv99dZ6u8GkQ7b35Q7W7R",
    },
    {
      id: "sol",
      name: "Solana",
      symbol: "SOL",
      network: "Solana Mainnet (SPL)",
      networkEs: "Solana Mainnet (SPL)",
      address: "7hE5kZ3uYgK9uJmX8PsqYv99dZ6u8GkQ7b35Q7W7Rxyz",
    },
  ],
  platforms: [
    {
      id: "paypal",
      name: "PayPal",
      description:
        "Instant direct transfer via balance, debit, or credit card.",
      descriptionEs:
        "Transferencia directa con saldo PayPal o tarjeta de débito/crédito.",
      url: "https://paypal.me/arturonavax",
      badge: "Active",
      badgeEs: "Activo",
      icon: "paypal",
    },
    {
      id: "github",
      name: "GitHub Sponsors",
      description: "Support open-source research and engineering pipelines.",
      descriptionEs:
        "Patrocina herramientas de código abierto e investigación.",
      url: "https://github.com/sponsors/arturonavax",
      badge: "Verified",
      badgeEs: "Verificado",
      icon: "github",
    },
  ],
  futureIntegrations: [
    {
      id: "stripe",
      name: "Card Checkout (Coming Soon)",
      description:
        "Zero-redirect card checkout with automatic currency conversion & Apple/Google Pay.",
      descriptionEs:
        "Checkout con tarjeta sin redirecciones, conversión automática y Apple/Google Pay.",
      badge: "Roadmap",
      badgeEs: "En Desarrollo",
      type: "stripe",
      status: "planned",
    },
    {
      id: "web3",
      name: "Web3 Direct Wallet Tip",
      description:
        "Direct browser wallet connection (MetaMask, Phantom, Rabby) for native token transfer.",
      descriptionEs:
        "Conexión de billetera directa (MetaMask, Phantom, Rabby) para transferencias nativas.",
      badge: "Stub Protocol",
      badgeEs: "Prototipo Web3",
      type: "web3",
      status: "prototype",
    },
  ],
};
*/

export const hasSponsorshipMethods =
  (sponsorshipData.crypto && sponsorshipData.crypto.length > 0) ||
  (sponsorshipData.platforms && sponsorshipData.platforms.length > 0);
