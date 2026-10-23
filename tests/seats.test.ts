import {describe,it,expect} from 'vitest';
import {seatPricing,seatLimit} from '../shared/seats';
describe('Organization seat prices in integer cents',()=>{
 it('includes one Pro user and prices the second and third at ten euros',()=>{
  expect([1,2,3].map(n=>seatPricing('pro',n).totalCents)).toEqual([2999,3999,4999]);expect(seatLimit('pro')).toBe(3);
 });
 it('includes one Business user and accepts a negotiated additional-seat price, including zero',()=>{
  expect(seatPricing('business',1,6900).totalCents).toBe(6900);expect(seatPricing('business',3,6900).totalCents).toBe(9900);
  expect(seatPricing('business',100,6900,'monthly',false,800).totalCents).toBe(86100);
  expect(seatPricing('business',10,6900,'monthly',false,0).totalCents).toBe(6900);expect(seatLimit('business')).toBeNull();
 });
 it('uses the base for the selected cycle and twelve months of additional users for annual contracts',()=>{
  expect(seatPricing('business',3,69000,'yearly',false,1200)).toMatchObject({baseCents:69000,seatCents:28800,totalCents:97800});
  expect(seatPricing('business',2).totalCents).toBeNull();expect(seatPricing('business',3,null,'monthly',true).totalCents).toBe(0);
 });
});
