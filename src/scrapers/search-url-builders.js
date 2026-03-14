const { getSearchParams } = require('./search-params');

function buildBridgesUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    view: 'grid',
    department: 'residential-sales',
    destination: search.locationSlug,
    radius: '',
    minimum_bedrooms: String(search.minBedrooms || 0),
    maximum_price: search.maxPrice ? String(search.maxPrice) : '',
    maximum_rent: '999999999999',
    property_type: '',
    'exclude-sold': 'on',
  });
  return `https://www.bridges.co.uk/properties/?${params.toString()}`;
}

function buildOnTheMarketUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams();
  if (search.minBedrooms) params.set('min-bedrooms', String(search.minBedrooms));
  if (search.maxPrice) params.set('max-price', String(search.maxPrice));
  return `https://www.onthemarket.com/for-sale/property/${search.locationSlug}/?${params.toString()}`;
}

function buildZooplaUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    beds_min: String(search.minBedrooms || 0),
    is_auction: 'false',
    is_retirement_home: 'false',
    is_shared_ownership: 'false',
    property_sub_type: 'semi_detached',
    search_source: 'for-sale',
    tenure: 'freehold',
    q: search.locationQuery,
  });
  params.append('property_sub_type', 'detached');
  params.append('property_sub_type', 'terraced');
  if (search.maxPrice) params.set('price_max', String(search.maxPrice));
  return `https://www.zoopla.co.uk/for-sale/houses/${search.county.toLowerCase()}/${search.locationSlug}/?${params.toString()}`;
}

function buildRomansUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams();
  if (search.minBedrooms) params.set('min_bedrooms', String(search.minBedrooms));
  if (search.maxPrice) params.set('max_price', String(search.maxPrice));
  return `https://www.romans.co.uk/properties/for-sale/in-${search.locationSlug}/?${params.toString()}`;
}

function buildChartersUrl() {
  const search = getSearchParams();
  return `https://www.chartersestateagents.co.uk/property/for-sale/in-${search.locationSlug}/${search.minBedrooms || 0}-and-more-bedrooms/`;
}

function buildWprUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    orderby: '',
    instruction_type: 'sale',
    address_keyword: search.location,
    min_bedrooms: String(search.minBedrooms || 0),
    minprice: '',
    maxprice: search.maxPrice ? String(search.maxPrice) : '',
    property_type: '',
    showstc: '',
  });
  return `https://www.wpr.co.uk/property-search/?${params.toString()}`;
}

function buildBourneUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    department: 'residential-sales',
    address_keyword: search.locationSlug,
    minimum_bedrooms: String(search.minBedrooms || 0),
  });
  if (search.maxPrice) params.set('maximum_price', String(search.maxPrice));
  return `https://bourneestateagents.com/search/?${params.toString()}`;
}

function buildGreenwoodUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    q: search.locationSlug,
    bedrooms_min: String(search.minBedrooms || 0),
  });
  return `https://www.greenwood-property.co.uk/properties/sales?${params.toString()}`;
}

function buildAndrewLodgeUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    minimum_bedrooms: String(search.minBedrooms || 0),
    orderby: 'price_desc',
  });
  if (search.maxPrice) params.set('maximum_price', String(search.maxPrice));
  return `https://andrewlodge.net/property-for-sale-in-${search.locationSlug}/?${params.toString()}`;
}

function buildHamptonsUrl() {
  const search = getSearchParams();
  let url = `https://www.hamptons.co.uk/properties/sales/text-${search.locationSlug}/from-${search.minBedrooms || 0}-bed`;
  if (search.maxPrice) url += `/under-${search.maxPrice}`;
  return url;
}

function buildCurchodsUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    attr: '1',
    min: '0',
    max: search.maxPrice ? String(search.maxPrice) : '0',
    bmin: String(search.minBedrooms || 0),
    bmax: '0',
    sortby: 'HL',
    added: 'anytime',
  });
  return `https://curchods.com/houses-for-sale-in/${encodeURIComponent(search.location)}/paged/1/?${params.toString()}`;
}

function buildWinkworthUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams();
  if (search.minBedrooms) params.set('min_beds', String(search.minBedrooms));
  if (search.maxPrice) params.set('max_price', String(search.maxPrice));
  return `https://www.winkworth.co.uk/${search.county.toLowerCase()}/${search.locationSlug}/properties-for-sale?${params.toString()}`;
}

function buildGascoignePeesUrl() {
  const search = getSearchParams();
  const parts = [search.location, search.county].filter(Boolean).join('-').toLowerCase();
  return `https://www.gpees.co.uk/buy/search/${parts}/`;
}

function buildBurnsAndWebberUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    attr: '1',
    currentpage: '1',
  });
  return `https://burnsandwebber.com/properties-for-sale-in/${search.locationSlug}/?${params.toString()}`;
}

function buildKeatsfearnUrl() {
  return 'https://www.keatsfearn.co.uk/properties/sales#/';
}

function buildSavillsUrl() {
  const search = getSearchParams();
  const bedsCode = search.minBedrooms ? `GRS_B_${search.minBedrooms}` : 'GRS_B_3';
  return `https://search.savills.com/list?SearchList=Id_40145+Category_TownVillageCity&Tenure=GRS_T_B&SortOrder=SO_PCDD&Currency=GBP&PropertyTypes=GRS_PT_H,GRS_PT_ND,GRS_PT_B,GRS_PT_CTTG&Bedrooms=${bedsCode}&Category=GRS_CAT_RES`;
}

function buildTruemangrundyUrl() {
  const search = getSearchParams();
  const params = new URLSearchParams({
    department: 'residential-sales',
    minimum_bedrooms: String(search.minBedrooms || 3),
  });
  if (search.maxPrice) params.set('maximum_price', String(search.maxPrice));
  return `https://www.truemanandgrundy.co.uk/property/?${params.toString()}`;
}

module.exports = {
  buildAndrewLodgeUrl,
  buildBourneUrl,
  buildBridgesUrl,
  buildBurnsAndWebberUrl,
  buildChartersUrl,
  buildCurchodsUrl,
  buildGascoignePeesUrl,
  buildGreenwoodUrl,
  buildHamptonsUrl,
  buildKeatsfearnUrl,
  buildOnTheMarketUrl,
  buildRomansUrl,
  buildSavillsUrl,
  buildTruemangrundyUrl,
  buildWinkworthUrl,
  buildWprUrl,
  buildZooplaUrl,
};
