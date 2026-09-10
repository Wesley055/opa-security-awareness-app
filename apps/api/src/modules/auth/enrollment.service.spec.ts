import { ConfigService } from '@nestjs/config';
import { EnrollmentService } from './enrollment.service';
import { revealIdentity } from '../../shared/security/enrollment-identity';
import { randomUUID } from 'crypto';
describe('enrollment intake work independent of global identity',()=>{
  const config=new ConfigService({ENROLLMENT_ENCRYPTION_KEY:'ab'.repeat(32)});
  const data={firstName:'Test',lastName:'User',email:'TEST@example.test',phoneNumber:'+2348012345678'};
  it.each([null,{id:'global-account'}])('never queries global accounts before creating a receipt (%p)',async existing=>{
    const id=randomUUID();
    const tx={$executeRaw:jest.fn(),user:{findUnique:jest.fn(async()=>existing),findFirst:jest.fn(async()=>existing),create:jest.fn()},enrollmentRequest:{findUnique:jest.fn(async()=>null),create:jest.fn(async()=>({id}))},accountInvitationDelivery:{createMany:jest.fn()}};
    const service=new EnrollmentService({$transaction:async(fn:(value:typeof tx)=>unknown)=>fn(tx)} as never,config);
    expect(await service.request(data,'request-key')).toEqual({requestId:id,status:'VERIFICATION_PENDING'});
    expect(tx.user.findUnique).not.toHaveBeenCalled();expect(tx.user.findFirst).not.toHaveBeenCalled();expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.accountInvitationDelivery.createMany).toHaveBeenCalledWith({data:expect.arrayContaining([expect.objectContaining({enrollmentId:id,channel:'EMAIL',recipient:''}),expect.objectContaining({enrollmentId:id,channel:'SMS',recipient:''})])});
    expect(revealIdentity(config,(tx.enrollmentRequest.create.mock.calls as unknown as [{data:{identityCiphertext:string}}][])[0]![0].data.identityCiphertext)).toEqual({...data,email:'test@example.test'});
  });
  it('reuses a receipt without additional delivery work on retry',async()=>{
    const id=randomUUID(),tx={$executeRaw:jest.fn(),enrollmentRequest:{findUnique:jest.fn(async()=>({id})),create:jest.fn()},accountInvitationDelivery:{createMany:jest.fn()}};
    const service=new EnrollmentService({$transaction:async(fn:(value:typeof tx)=>unknown)=>fn(tx)} as never,config);
    expect(await service.request(data,'retry')).toEqual({requestId:id,status:'VERIFICATION_PENDING'});
    expect(tx.enrollmentRequest.create).not.toHaveBeenCalled();expect(tx.accountInvitationDelivery.createMany).not.toHaveBeenCalled();
  });
  it('rejects a missing bulk idempotency key before accepting rows',async()=>{
    const service=new EnrollmentService({} as never,config);
    await expect(service.bulk([data],'','facility','actor')).rejects.toThrow('A request idempotency key is required.');
  });
});
