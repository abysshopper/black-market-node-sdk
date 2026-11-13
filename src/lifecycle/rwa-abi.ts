// Generated from the verified RWA collector/registry ABIs by scripts/generate-rwa-presets.mjs.
// Provenance: test/fixtures/rwa-registry-readback.json, abiProvenance.
export const rwaRewardCollectorV1Abi = [
  {
    "inputs": [],
    "name": "InexactTransfer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientEarmark",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPremium",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRecipient",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShare",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidWeights",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SlippageExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Unauthorized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnsupportedAsset",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroFill",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "weightBps",
        "type": "uint16"
      }
    ],
    "name": "RwaAssetEarmarked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "launchToken",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "poolId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "grossQuoteCollected",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "earmarkedQuote",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "forwardedQuote",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "shareBps",
        "type": "uint16"
      }
    ],
    "name": "RwaFeesEarmarked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "assetAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "quoteAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "premiumBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "maxPriceAge",
        "type": "uint32"
      }
    ],
    "name": "RwaFilled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "previousMaxPriceAge",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "newMaxPriceAge",
        "type": "uint32"
      }
    ],
    "name": "RwaMaxPriceAgeUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "previousPremiumBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "newPremiumBps",
        "type": "uint16"
      }
    ],
    "name": "RwaPremiumUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "previousShareBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "newShareBps",
        "type": "uint16"
      }
    ],
    "name": "RwaShareUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RwaStockForwardSkipped",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RwaStockForwarded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "launchToken",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "poolId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "hub",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "uint16",
            "name": "shareBps",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "premiumBps",
            "type": "uint16"
          },
          {
            "internalType": "uint32",
            "name": "maxPriceAge",
            "type": "uint32"
          },
          {
            "internalType": "address[]",
            "name": "basket",
            "type": "address[]"
          },
          {
            "internalType": "uint16[]",
            "name": "weightsBps",
            "type": "uint16[]"
          }
        ],
        "indexed": false,
        "internalType": "struct RwaLaunchConfigV1",
        "name": "terms",
        "type": "tuple"
      }
    ],
    "name": "RwaTermsInitialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16[]",
        "name": "weightsBps",
        "type": "uint16[]"
      }
    ],
    "name": "RwaWeightsUpdated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "basket",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "earmarked",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minQuoteOut",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "fill",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "quoteOut",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "forward",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "amounts",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "hub",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "launchToken",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "maxFill",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "assetAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "quoteOut",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxPriceAge",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "pendingStock",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "poolId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "premiumBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quoteAsset",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "registry",
    "outputs": [
      {
        "internalType": "contract RwaAssetRegistryV1",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "newMaxPriceAge",
        "type": "uint32"
      }
    ],
    "name": "setMaxPriceAge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "newPremiumBps",
        "type": "uint16"
      }
    ],
    "name": "setPremiumBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "newShareBps",
        "type": "uint16"
      }
    ],
    "name": "setShareBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16[]",
        "name": "newWeightsBps",
        "type": "uint16[]"
      }
    ],
    "name": "setWeights",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "shareBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalEarmarked",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "weightBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "weight",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const rwaAssetRegistryV1Abi = [
  {
    "inputs": [],
    "name": "InvalidPremium",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPrice",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotListed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OraclePaused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "QuoteDepegged",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "StalePrice",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "AssetRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "feed",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "maxStaleSeconds",
        "type": "uint32"
      }
    ],
    "name": "AssetSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "feed",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "maxStaleSeconds",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "pegBandBps",
        "type": "uint16"
      }
    ],
    "name": "QuoteFeedSet",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "assetFeed",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "feed",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "maxStaleSeconds",
            "type": "uint32"
          },
          {
            "internalType": "bool",
            "name": "listed",
            "type": "bool"
          }
        ],
        "internalType": "struct RwaAssetRegistryV1.AssetFeed",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "quoteAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "premiumBps",
        "type": "uint16"
      },
      {
        "internalType": "uint32",
        "name": "maxPriceAge",
        "type": "uint32"
      }
    ],
    "name": "assetFor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      }
    ],
    "name": "isListed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "listedAssets",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quoteAsset",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quoteFeed",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint16",
        "name": "premiumBps",
        "type": "uint16"
      },
      {
        "internalType": "uint32",
        "name": "maxPriceAge",
        "type": "uint32"
      }
    ],
    "name": "quoteFor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quoteMaxStaleSeconds",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quotePegBandBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
