import DiplomacyBoard, { PROVINCES, unitCanOccupy } from './games/diplomacy/DiplomacyBoard.js';
import { obj, shape, array, map, text, progressText, number, integer, one, nullable, bool, count, timestamp, powers, safeTree, bytes, fail } from './migrationSchema.js';

const power = one(...powers), short = text(80), unitType = one('army','fleet');
const provinceKey = /^[A-Z]{3}(\/(nc|sc|ec))?$/;
const province = v => typeof v === 'string' && provinceKey.test(v) && Object.hasOwn(PROVINCES,v.split('/')[0]);
const countryMap = test => shape({},Object.fromEntries(powers.map(p => [p,test])));
const provinces = test => map(test,provinceKey,100);
const unit = shape({power,type:unitType});
const orderFields = {
  hold:{unitLoc:province}, move:{unitLoc:province,to:province},
  'support-hold':{unitLoc:province,target:province}, 'support-move':{unitLoc:province,from:province,to:province},
  convoy:{unitLoc:province,from:province,to:province}, build:{power,unitType,loc:province}, disband:{unitLoc:province},
};
const order = v => v && Object.hasOwn(orderFields,v.type) && shape({type:one(v.type),...orderFields[v.type]},
  {power:nullable(power),...(v.type === 'move' ? {viaConvoy:bool,failedConvoy:bool} : {})})(v);
const dislodged = shape({unitLoc:province,unit,attackerFrom:province});
const retreat = shape({unitLoc:province,unit,attackerFrom:province,options:array(province,100)});
const resolution = shape({moveSuccess:provinces(bool),cutSupports:array(province,100),dislodged:array(dislodged,100),strengths:shape({move:provinces(count),defense:provinces(count)})});
const history = shape({phase:short},{orders:provinces(order),resolved:resolution,retreats:array(retreat,100),retreatResolution:array(text(),100),adjustments:array(text(),100)});
const adjustment = shape({delta:integer(-100,100),openHomes:array(province,100),buildCount:count,disbandCount:count});
function boardSchema(value, allowHistory = true) {
  const schema = shape({
    powers:array(power,7),units:provinces(unit),supplyCenters:provinces(nullable(power)),
    phase:one('spring-orders','spring-retreats','fall-orders','fall-retreats','winter-build','game-over'),
    season:one('spring','fall','winter'),year:integer(1901,2100),turnNumber:count,maxYears:integer(1901,2000),
    winner:nullable(power),winningCenters:count,lastAction:text(),orderHistory:array(history,12),pendingRetreats:array(retreat,100),
    contestedProvinces:array(province,100),adjustments:countryMap(adjustment),
    stateHistory:array(raw => {
      if (!allowHistory || !text(400000)(raw)) return false;
      try { const v = JSON.parse(raw); return safeTree(v) && boardSchema(v,false); } catch (_) { return false; }
    },allowHistory ? 80 : 0),historyIndex:integer(-1,79),maxHistoryLength:integer(1,80),
  });
  if (!schema(value)) return false;
  return Object.entries(value.units).every(([loc,u]) => province(loc) && unitCanOccupy(u.type,loc)) &&
    Object.keys(value.supplyCenters).every(province) && value.historyIndex < value.stateHistory.length;
}
const stance = one('ally','friendly','neutral','rival','enemy');
// Scratchpads are stored verbatim from agent replies, which the writers check
// only for these typed fields (agents/memory.js validateScratchpad). Other keys,
// such as priority/note, are open JSON: bounded here in count and key length,
// covered by the caller's safeTree secret-key denylist and the 5 MiB envelope.
// Replies are capped at 700 output tokens, well inside these bounds.
const openShape = (required, maxExtra = 256) => v => obj(v) &&
  Object.entries(required).every(([k,test]) => Object.hasOwn(v,k) && test(v[k])) &&
  Object.keys(v).filter(k => !Object.hasOwn(required,k)).length <= maxExtra && Object.keys(v).every(k => k.length <= 4096);
const disposition = openShape({trust:number(-1,1),stance,intent:progressText});
const scratchpad = openShape({self:v => progressText(v) && v.length > 0,dispositions:v => obj(v) && Object.keys(v).length <= 256 && Object.entries(v).every(([k,d]) => k.length <= 4096 && disposition(d)),confidence:number(0,1)});
const persona = shape({name:text(256),temperament:shape({trust:number(0,1),aggression:number(0,1)}),openingDisposition:countryMap(stance),blurb:text(10000)});
const conversations = shape({threads:countryMap(shape({power,messages:array(shape({role:one('user','assistant'),content:progressText,turn:short}),100000),scratchpad:nullable(scratchpad),updatedAt:timestamp}))});
const relationKey = new RegExp(`^(?:${powers.join('|')})>(?:${powers.join('|')})$`);
const channelKey = new RegExp(`^(?:${powers.join('|')})~(?:${powers.join('|')})$`);
// Deal locations follow the agent endpoint's validateDeal contract, which admits
// case-insensitive 2-4 letter ids stored verbatim (the betrayal model compares
// them case-insensitively). Durable-promise promotion stores power ids instead.
const dealLocation = v => typeof v === 'string' && /^[A-Za-z]{2,4}(\/(nc|sc|ec))?$/.test(v);
const placeOrPower = v => dealLocation(v) || power(v);
// validateDeal admits any non-empty joint-attack target string.
const dealTarget = v => progressText(v) && v.length > 0;
const agreement = shape({id:short,type:one('support','dmz','non-aggression','joint-attack')},{parties:array(power,7),from:nullable(placeOrPower),to:nullable(placeOrPower),provinces:array(dealLocation,1000),target:dealTarget,actingPower:power,phase:short});
const promise = shape({id:short,type:one('support'),from:nullable(power),to:nullable(power),expectedOrder:nullable(order),madePhase:nullable(short),actingPower:nullable(power)});
const diplomacy = shape({version:one(1),humanPower:nullable(power),relations:map(shape({trust:number(-1,1),lastUpdatedPhase:nullable(short)}),relationKey,49),
  agreements:array(agreement,100000),promises:array(promise,100000),promiseLedger:map(shape({kept:count,broken:count}),relationKey,49),scratchpads:countryMap(scratchpad),summaries:map(text(200),channelKey,49)});
const envelope = shape({version:one(1),savedAt:timestamp,board:boardSchema,uiPhase:one('negotiation','orders','resolving','retreats','winter','game-over'),
  controllers:nullable(countryMap(one('human','AI'))),personas:nullable(countryMap(persona)),conversations:nullable(conversations),diplomaticState:nullable(diplomacy),
  uiState:nullable(shape({pendingOrders:provinces(order),retreatChoices:provinces(v => v === 'DISBAND' || province(v)),buildOrders:countryMap(array(order,100))})),
});
export function validateDiplomacy(value) {
  // Persistence's 400 KB cap only trims conversations, never board history.
  if (!safeTree(value) || bytes(JSON.stringify(value)) > 5 * 1024 * 1024 || !envelope(value)) fail();
  const board = DiplomacyBoard.fromSerializedState(value.board);
  for (const loc of Object.keys(board.units)) board.getLegalOrdersForUnit(loc);
}
