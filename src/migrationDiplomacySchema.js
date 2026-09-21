import DiplomacyBoard, { PROVINCES, unitCanOccupy } from './games/diplomacy/DiplomacyBoard.js';
import { shape, array, map, text, number, integer, one, nullable, bool, count, timestamp, powers, safeTree, bytes, fail } from './migrationSchema.js';

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
    phase:one('spring-orders','spring-retreats','fall-orders','fall-retreats','winter-adjustments','game-over'),
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
const scratchpad = shape({self:text(2000),dispositions:countryMap(shape({trust:number(-1,1),stance,intent:text(2000)},{note:text(2000)})),confidence:number(0,1)},{priority:text(2000)});
const persona = shape({name:text(256),temperament:shape({trust:number(0,1),aggression:number(0,1)}),openingDisposition:countryMap(stance),blurb:text(10000)});
const conversations = shape({threads:countryMap(shape({power,messages:array(shape({role:one('user','assistant'),content:text(10000),turn:short}),2000),scratchpad:nullable(scratchpad),updatedAt:timestamp}))});
const relationKey = new RegExp(`^(?:${powers.join('|')})>(?:${powers.join('|')})$`);
const channelKey = new RegExp(`^(?:${powers.join('|')})~(?:${powers.join('|')})$`);
const placeOrPower = v => province(v) || power(v);
const agreement = shape({id:short,type:one('support','dmz','non-aggression','joint-attack')},{parties:array(power,7),from:nullable(placeOrPower),to:placeOrPower,provinces:array(province,100),target:power,actingPower:power,phase:short});
const promise = shape({id:short,type:one('support'),from:nullable(power),to:nullable(power),expectedOrder:nullable(order),madePhase:nullable(short),actingPower:nullable(power)});
const diplomacy = shape({version:one(1),humanPower:nullable(power),relations:map(shape({trust:number(-1,1),lastUpdatedPhase:nullable(short)}),relationKey,49),
  agreements:array(agreement,2000),promises:array(promise,2000),promiseLedger:map(shape({kept:count,broken:count}),relationKey,49),scratchpads:countryMap(scratchpad),summaries:map(text(200),channelKey,49)});
const envelope = shape({version:one(1),savedAt:timestamp,board:boardSchema,uiPhase:one('negotiation','orders','resolving','retreats','winter','game-over'),
  controllers:nullable(countryMap(one('human','AI'))),personas:nullable(countryMap(persona)),conversations:nullable(conversations),diplomaticState:nullable(diplomacy),
  uiState:nullable(shape({pendingOrders:provinces(order),retreatChoices:provinces(v => v === 'DISBAND' || province(v)),buildOrders:countryMap(array(order,100))})),
});
export function validateDiplomacy(value) {
  if (!safeTree(value) || bytes(JSON.stringify(value)) > 400000 || !envelope(value)) fail();
  const board = DiplomacyBoard.fromSerializedState(value.board);
  for (const loc of Object.keys(board.units)) board.getLegalOrdersForUnit(loc);
}
