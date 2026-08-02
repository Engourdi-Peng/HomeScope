/**
 * Phase 1 extraction fixtures for building pages, private rooms,
 * zpid pollution, and cross-building SPA navigation.
 */

export interface ExtractionFixture {
  url: string;
  description: string;
  /** Raw __NEXT_DATA__ JSON string */
  nextData?: string;
  /** Raw JSON-LD scripts */
  jsonLdScripts?: string[];
  /** For DOM-based private room detection */
  rawDescription?: string;
  rawWhatsSpecial?: string;
  listingSubType?: string;
  /** Expected fields */
  expectedListingScope?: string;
  expectedListingType?: 'rent' | 'sale' | 'unknown';
  expectedAddress?: string;
  /** Studio fixture: structured bedrooms should remain 0 (not be flipped to 1) */
  expectedBedrooms?: number;
  expectedBathrooms?: number;
  expectedSqft?: number;
  expectedMonthlyRent?: number | null;
  expectedBuildingName?: string | null;
  expectedAvailableUnitsCount?: number;
  expectedIsBuilding?: boolean;
  /** If true, extract() should return extraction unavailable (null) */
  expectUnavailable?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Sale single-property page
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_SALE_SINGLE: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/1425-N-Alta-Vista-Blvd-Los-Angeles-CA-90046/2088603809_zpid/',
  description: 'Sale single family home',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            '2088603809_zpid': {
              zpid: '2088603809',
              streetAddress: '1425 N Alta Vista Blvd',
              city: 'Los Angeles',
              state: 'CA',
              zipcode: '90046',
              price: 2100000,
              bedrooms: 4,
              bathrooms: 3,
              livingArea: 2800,
              homeStatus: 'FOR_SALE',
              homeType: 'SINGLE_FAMILY',
            },
            // Pollution: stale entry from a different listing
            '99999999_zpid': {
              zpid: '99999999',
              streetAddress: 'STALE ADDRESS WRONG',
              price: 999999,
              bedrooms: 1,
              bathrooms: 1,
              homeStatus: 'FOR_RENT',
            },
          },
        },
      },
    },
  }),
  expectedListingScope: 'single_property',
  expectedListingType: 'sale',
  expectedAddress: '1425 N Alta Vista Blvd',
  expectedMonthlyRent: null,
  expectUnavailable: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Rent entire home
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_RENT_ENTIRE: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/742-E-6th-St-Los-Angeles-CA-90014/11223344_zpid/',
  description: 'Entire home for rent',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            '11223344_zpid': {
              zpid: '11223344',
              streetAddress: '742 E 6th St',
              city: 'Los Angeles',
              state: 'CA',
              zipcode: '90014',
              price: 3800,
              bedrooms: 2,
              bathrooms: 1,
              livingArea: 1100,
              homeStatus: 'FOR_RENT',
              homeType: 'APARTMENT',
            },
          },
        },
      },
    },
  }),
  expectedListingScope: 'entire_home',
  expectedListingType: 'rent',
  expectedMonthlyRent: 3800,
  expectUnavailable: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Rent private room in shared home (strong signal in description)
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_RENT_PRIVATE_ROOM: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/500-W-Olympic-Blvd-Los-Angeles-CA-90015/55667788_zpid/',
  description: 'Private room for rent in shared townhome',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            '55667788_zpid': {
              zpid: '55667788',
              streetAddress: '500 W Olympic Blvd',
              city: 'Los Angeles',
              state: 'CA',
              zipcode: '90015',
              price: 1200,
              bedrooms: 1,
              bathrooms: 1,
              livingArea: 200,
              homeStatus: 'FOR_RENT',
              homeType: 'CONDO',
            },
          },
        },
      },
    },
  }),
  rawDescription:
    'Spacious private room available in a shared townhome. The room has a private bedroom and closet. No private bath — shared bathroom. There are housemates already living in the other bedrooms. Available immediately.',
  rawWhatsSpecial: 'Private room with great natural light. Room in townhome. Bedrooms can be rented separately.',
  expectedListingScope: 'private_room',
  expectedListingType: 'rent',
  expectedMonthlyRent: 1200,
  expectUnavailable: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Multi-unit building page (/apartments/)
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_MULTI_UNIT_BUILDING: ExtractionFixture = {
  url: 'https://www.zillow.com/apartments/los-angeles-ca/urbanlux-sunset-premium/5YsP4L/',
  description: 'Apartment building with multiple floor plans',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          initialReduxState: {
            gdp: {
              building: {
                buildingId: '5YsP4L',
                buildingName: 'Urbanlux Sunset Premium',
                streetAddress: '1000 Sunset Blvd',
                city: 'Los Angeles',
                state: 'CA',
                zipcode: '90028',
                bestMatchedUnit: {
                  hdpUrl: 'https://www.zillow.com/homedetails/1000-Sunset-Blvd-Los-Angeles-CA-90028/1234567890_zpid/',
                  unitNumber: '201',
                },
                floorPlans: [
                  {
                    name: 'Studio',
                    beds: 0,
                    baths: 1,
                    sqft: 500,
                    minPrice: 2200,
                    maxPrice: 2400,
                    units: [
                      { unitId: '1111111111', name: 'Unit 101', beds: 0, baths: 1, sqft: 500, price: 2200, availableFrom: '2026-09-01' },
                      { unitId: '1111111112', name: 'Unit 102', beds: 0, baths: 1, sqft: 500, price: 2300, availableFrom: '2026-10-01' },
                    ],
                  },
                  {
                    name: '1 Bedroom',
                    beds: 1,
                    baths: 1,
                    sqft: 750,
                    minPrice: 2800,
                    maxPrice: 3200,
                    units: [
                      { unitId: '2222222221', name: 'Unit 201', beds: 1, baths: 1, sqft: 750, price: 2900, availableFrom: '2026-09-15' },
                      { unitId: '2222222222', name: 'Unit 202', beds: 1, baths: 1, sqft: 750, price: 3000, availableFrom: '2026-11-01' },
                    ],
                  },
                  {
                    name: '2 Bedroom',
                    beds: 2,
                    baths: 2,
                    sqft: 1100,
                    minPrice: 3800,
                    maxPrice: 4200,
                    units: [
                      { unitId: '3333333331', name: 'Unit 301', beds: 2, baths: 2, sqft: 1100, price: 3900, availableFrom: null },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  }),
  expectedListingScope: 'multi_unit_building',
  expectedListingType: 'rent',
  expectedMonthlyRent: null,
  expectedBuildingName: 'Urbanlux Sunset Premium',
  expectedAvailableUnitsCount: 5,
  expectedIsBuilding: true,
  expectUnavailable: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Selected unit within a building (/apartments/ with zpid)
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_SELECTED_UNIT: ExtractionFixture = {
  url: 'https://www.zillow.com/apartments/los-angeles-ca/urbanlux-sunset-premium/5YsP4L/1234567890_zpid/',
  description: 'Specific unit selected within apartment building',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          initialReduxState: {
            gdp: {
              building: {
                buildingId: '5YsP4L',
                buildingName: 'Urbanlux Sunset Premium',
                streetAddress: '1000 Sunset Blvd',
                city: 'Los Angeles',
                state: 'CA',
                zipcode: '90028',
                bestMatchedUnit: {
                  hdpUrl: 'https://www.zillow.com/homedetails/1000-Sunset-Blvd-Los-Angeles-CA-90028/1234567890_zpid/',
                  unitNumber: '201',
                },
                floorPlans: [
                  {
                    name: '1 Bedroom',
                    beds: 1,
                    baths: 1,
                    sqft: 750,
                    minPrice: 2800,
                    maxPrice: 3200,
                    units: [
                      { unitId: '1234567890', name: 'Unit 201', beds: 1, baths: 1, sqft: 750, price: 2900, availableFrom: '2026-09-15' },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
  }),
  expectedListingScope: 'selected_unit',
  expectedListingType: 'rent',
  expectedMonthlyRent: 2900,
  expectedBuildingName: 'Urbanlux Sunset Premium',
  expectedAvailableUnitsCount: 1,
  expectUnavailable: false,
};

// ───────────────────────────────────────────────────────────────────────────
// Pollution: gdpClientCache contains stale zpid from previous building
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_GDP_POLLUTION: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/555-Main-St-New-York-NY-10001/777777777_zpid/',
  description: 'Stale gdpClientCache entry must be rejected',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            // Stale: wrong zpid — must be REJECTED
            '111111111_zpid': {
              zpid: '111111111',
              streetAddress: 'STALE OLD ADDRESS 111 Main St',
              price: 1000,
              bedrooms: 0,
              bathrooms: 1,
              homeStatus: 'FOR_RENT',
            },
            // Also stale: different zpid
            '222222222_zpid': {
              zpid: '222222222',
              streetAddress: 'STALE WRONG ADDRESS 222 Main St',
              price: 500,
              bedrooms: 0,
              bathrooms: 1,
              homeStatus: 'FOR_RENT',
            },
          },
        },
      },
    },
  }),
  // No entry matching 777777777_zpid → extraction unavailable
  expectUnavailable: true,
};

// ───────────────────────────────────────────────────────────────────────────
// SPA cross-building pollution: after navigating from building A to building B,
// gdp.building still has A's data; must be rejected by fresh URL mismatch
// ───────────────────────────────────────────────────────────────────────────
export const FIXTURE_SPA_BUILDING_TRANSITION: ExtractionFixture = {
  url: 'https://www.zillow.com/apartments/los-angeles-ca/building-b/BldgIdB/',
  description: 'SPA nav from building A to B — stale gdp.building must be rejected',
  // gdp.building has buildingId of PREVIOUS building — must not be used
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          initialReduxState: {
            gdp: {
              building: {
                // This is building A's data — URL says building B
                buildingId: 'BldgIdA',
                buildingName: 'WRONG BUILDING A',
                streetAddress: '1 Wrong St',
                city: 'Los Angeles',
                state: 'CA',
                zipcode: '90028',
                bestMatchedUnit: {
                  hdpUrl: 'https://www.zillow.com/homedetails/1-Wrong-St-Los-Angeles-CA-90028/1111111111_zpid/',
                },
                floorPlans: [
                  { name: 'Studio', beds: 0, baths: 1, sqft: 400, minPrice: 1500 },
                ],
              },
            },
          },
        },
      },
    },
  }),
  // Building ID mismatch (BldgIdA !== BldgIdB) + no listResults match → unavailable
  expectUnavailable: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Studio selected_unit — 725 N Logan St APT 5 / Governor's Park West / 2097740413.
//
// Real-page regression: description body included
// "studios and thoughtfully designed one-bedroom apartments", which a
// permissive body-text regex matched as "1 bedroom" and overwrote the
// structured bedrooms=0. The contract:
//   - property.bedrooms = 0  (Studio is a LEGAL value)
//   - description contains the noise phrase "studios and one-bedroom apartments"
//   - sqft must come through as 230
//   - bathrooms = 1 (whole-number truth)
//   - listingScope = selected_unit (URL has the unit zpid)
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_STUDIO_SELECTED_UNIT: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/725-N-Logan-St-APT-5-Denver-CO-80203/2097740413_zpid/',
  description: "Governor's Park West — Studio APT 5",
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            '2097740413_zpid': {
              zpid: '2097740413',
              streetAddress: '725 N Logan St APT 5',
              city: 'Denver',
              state: 'CO',
              zipcode: '80203',
              price: 800,
              bedrooms: 0,           // ← STUDIO — must be preserved
              bathrooms: 1,
              livingArea: 230,
              homeStatus: 'FOR_RENT',
              homeType: 'APARTMENT',
              description:
                'Welcome to charming Governor\'s Park West in the heart of Capitol Hill, where historic charm meets modern living. Constructed in 1911, this beautifully preserved building features a blend of classic architectural details and contemporary amenities. Choose from spacious studios and thoughtfully designed one-bedroom apartments, each offering an inviting atmosphere with ample natural light.',
            },
          },
        },
      },
    },
  }),
  expectedListingScope: 'selected_unit',
  expectedListingType: 'rent',
  expectedBathrooms: 1,
  expectedSqft: 230,
  expectUnavailable: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// gdpClientCache pollution: cache key has NO zpid suffix (e.g. "property"),
// but entry.property.zpid points to a DIFFERENT listing.
// Both the entry-level truth and the URL agree it's NOT this listing —
// extraction MUST be unavailable.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_GDP_CACHE_KEY_BUT_PROPERTY_ZPID_MISMATCH: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/777-Main-St-New-York-NY-10001/777777777_zpid/',
  description: 'cache key has no zpid, entry.property.zpid is another listing',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            // Looks like a generic-named cache entry. The KEY carries no zpid,
            // so the only place to read a zpid from is entry.property.zpid —
            // and that zpid is for a different listing.
            'some_other_property': {
              property: {
                zpid: '1111111111',                 // DIFFERENT from current URL (777777777)
                streetAddress: 'POLLUTED ADDRESS 1',
                city: 'New York',
                state: 'NY',
                zipcode: '10002',
                price: 900,
                bedrooms: 1,
                bathrooms: 1,
                homeStatus: 'FOR_RENT',
              },
            },
            // Another polluted entry: zpid disagrees
            'yet_another_property': {
              zpid: '2222222222',
              property: {
                zpid: '2222222222',                 // same as top-level zpid here, but still wrong
                streetAddress: 'POLLUTED ADDRESS 2',
                city: 'New York',
                state: 'NY',
                zipcode: '10003',
                price: 1500,
                bedrooms: 2,
                bathrooms: 1,
                homeStatus: 'FOR_RENT',
              },
            },
          },
        },
      },
    },
  }),
  // No entry whose zpid is 777777777 → extraction unavailable
  expectUnavailable: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// Entire-home description that MENTIONS "second-floor bedrooms" and
// "shared bathroom" — these phrasings MUST NOT trigger private_room.
// This is the negative case for the detectPrivateRoomSignal tightening.
// ─────────────────────────────────────────────────────────────────────────────
export const FIXTURE_ENTIRE_HOME_WITH_WEAK_PHRASES: ExtractionFixture = {
  url: 'https://www.zillow.com/homedetails/100-N-Wabash-Ave-Chicago-IL-60601/88888888_zpid/',
  description: 'Entire home listing whose description contains ambiguous weak phrases',
  nextData: JSON.stringify({
    props: {
      pageProps: {
        componentProps: {
          gdpClientCache: {
            '88888888_zpid': {
              zpid: '88888888',
              streetAddress: '100 N Wabash Ave',
              city: 'Chicago',
              state: 'IL',
              zipcode: '60601',
              price: 3500,
              bedrooms: 3,
              bathrooms: 2,
              livingArea: 1600,
              homeStatus: 'FOR_RENT',
              homeType: 'APARTMENT',
            },
          },
        },
      },
    },
  }),
  // The description contains "second-floor bedrooms" + "shared bathroom"
  // WITHOUT any strong single-room-rental phrasing. Must remain entire_home.
  rawDescription:
    'Beautifully renovated three bedroom entire home on the second floor. Bedroom on 2nd floor, second-floor bedrooms, with shared bathroom access from the hallway. Ideal for families or roommates. No private room offered. Available to rent as a single unit only.',
  rawWhatsSpecial: 'Whole apartment — every bedroom accessible to one tenant.',
  expectedListingScope: 'entire_home',
  expectedListingType: 'rent',
  expectedMonthlyRent: 3500,
  expectUnavailable: false,
};
