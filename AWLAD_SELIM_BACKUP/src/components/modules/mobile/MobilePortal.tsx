import React, { useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { LogOut, PackagePlus, ClipboardList, Truck } from 'lucide-react';

export const MobilePortal: React.FC = () => {
  const { currentUser, logout } = useAuth();
  const data = useData();
  const isRep = currentUser?.role === 'representative';
  const customer = useMemo(() => data.customers.find(c => c.userId === currentUser?.id || c.phone === currentUser?.phone), [data.customers, currentUser]);
  const rep = useMemo(() => data.representatives.find(r => r.userId === currentUser?.id || r.name === currentUser?.fullName), [data.representatives, currentUser]);
  const [items, setItems] = useState<Array<{productId:string; productName:string; unit:string; quantity:number}>>([]);
  const [productId, setProductId] = useState(''); const [quantity, setQuantity] = useState(1); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const activeProducts = data.products.filter(p => p.status === 'active');
  const addItem = () => { const p = activeProducts.find(x => x.id === productId); if (!p || quantity <= 0) return; setItems(v => [...v, { productId:p.id, productName:p.name, unit:p.baseUnit, quantity }]); setProductId(''); setQuantity(1); };
  const submit = async () => {
    if (!items.length) { setMessage('أضف الأصناف المطلوبة أولاً.'); return; }
    setBusy(true);
    if (isRep) {
      if (!rep) { setBusy(false); setMessage('حساب المندوب غير مربوط بملف مندوب. راجع الإدارة.'); return; }
      const source = data.warehouses.find(w => w.isDefault) || data.warehouses[0];
      if (!source) { setBusy(false); setMessage('يجب إعداد المخزن الرئيسي من الكمبيوتر أولاً.'); return; }
      let target = data.warehouses.find(w => w.id !== source.id && w.name.includes(rep.name));
      if (!target) {
        const created = await data.addWarehouse({ name:`عهدة المندوب - ${rep.name}`, code:`VAN-${rep.id.slice(-6)}`, location:'عهدة سيارة المندوب', managerName:rep.name, isDefault:false, status:'active' });
        target = created.warehouse;
      }
      if (!target) { setBusy(false); setMessage('تعذر إيجاد أو إنشاء مستودع عهدة المندوب.'); return; }
      const result = await data.createRepItemTransfer({ date: new Date().toISOString().split('T')[0], representativeId:rep.id, representativeName:rep.name, sourceWarehouseId:source.id, sourceWarehouseName:source.name, targetWarehouseId:target.id, targetWarehouseName:target.name, items:items.map(i=>({productId:i.productId,productName:i.productName,unit:i.unit,requestedQty:i.quantity,availableInVanQty:0,shortageQty:i.quantity})), notes });
      setBusy(false); setMessage(result.success ? 'تم إرسال طلب التحويل للكمبيوتر الرئيسي. لم يتم خصم المخزون.' : result.error || 'تعذر إرسال الطلب');
      if (result.success) { setItems([]); setNotes(''); }
    } else {
      if (!customer) { setBusy(false); setMessage('حساب العميل غير مربوط بملف عميل. راجع الإدارة.'); return; }
      const result = await data.createCustomerItemOrder({ customerId:customer.id, customerName:customer.name, items, notes });
      setBusy(false); setMessage(result.success ? 'تم إرسال طلبك للإدارة. الإدارة وحدها تحدد الأسعار وتنشئ الفاتورة بعد المراجعة.' : result.error || 'تعذر إرسال الطلب');
      if (result.success) { setItems([]); setNotes(''); }
    }
  };
  const myCustomerOrders = (data.customerItemOrders || []).filter(o=>o.customerId===customer?.id);
  const myRepTransfers = (data.repItemTransfers || []).filter(o=>o.representativeId===rep?.id);
  const confirmRepReceipt = async (id:string) => { const r = await data.updateRepItemTransferStatus(id, 'received', undefined, 'أكد المندوب الاستلام من التطبيق'); setMessage(r.success ? 'تم تأكيد استلام التحويل.' : r.error || 'تعذر تأكيد الاستلام'); };
  return <div dir="rtl" className="min-h-screen bg-slate-50 p-4 font-['Cairo']"><div className="mx-auto max-w-3xl space-y-4">
    <header className="flex items-center justify-between rounded-2xl bg-slate-950 p-4 text-white"><div><b className="text-lg">AWLAD SELIM</b><div className="text-xs text-blue-200">{isRep?'بوابة المندوب':'بوابة العميل'} · {currentUser?.fullName}</div></div><button onClick={logout} className="rounded-lg bg-white/10 px-3 py-2 text-sm"><LogOut className="inline" size={15}/> خروج</button></header>
    <section className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold"><PackagePlus size={18}/>{isRep?'طلب تحويل أصناف':'طلب أصناف من الشركة'}</h2><p className="text-xs leading-6 text-slate-500">{isRep?'اختر الأصناف والكميات وأرسل طلب التحويل. الإدارة تراجع وتنفذ من الكمبيوتر الرئيسي.':'اختر الأصناف والكميات. الإدارة تراجع الطلب وتنشئ الفاتورة بالأسعار التي تحددها؛ لا توجد أسعار أو فاتورة تلقائية.'}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_100px_auto]"><select value={productId} onChange={e=>setProductId(e.target.value)} className="rounded-xl border p-3 text-sm"><option value="">اختر الصنف</option>{activeProducts.map(p=><option key={p.id} value={p.id}>{p.name} · {p.code}</option>)}</select><input type="number" min="1" value={quantity} onChange={e=>setQuantity(Number(e.target.value))} className="rounded-xl border p-3 text-sm"/><button onClick={addItem} className="rounded-xl bg-blue-900 px-4 py-3 text-sm font-bold text-white">إضافة</button></div>
      {items.map((i,n)=><div key={`${i.productId}-${n}`} className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm"><span>{i.productName} × {i.quantity} {i.unit}</span><button onClick={()=>setItems(v=>v.filter((_,idx)=>idx!==n))} className="text-red-600">حذف</button></div>)}
      <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="ملاحظات اختيارية" className="w-full rounded-xl border p-3 text-sm" rows={2}/><button disabled={busy||!items.length} onClick={submit} className="w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">{busy?'جاري الإرسال...':'إرسال الطلب'}</button>{message&&<p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
    </section>
    {isRep?<section className="rounded-2xl border bg-white p-4"><h2 className="mb-3 flex items-center gap-2 font-bold"><Truck size={18}/> طلبات التحويل</h2>{myRepTransfers.map(r=><div key={r.id} className="mb-2 rounded-xl border p-3 text-sm"><b>{r.requestNumber}</b><p>{r.items.map(i=>`${i.productName} × ${i.requestedQty}`).join('، ')}</p><span className="text-blue-800">{r.status==='pending'?'بانتظار الإدارة':r.status==='approved'?'تمت الموافقة':r.status==='executed'?'تم تنفيذ التحويل - أكد الاستلام':r.status==='received'?'تم الاستلام':r.status==='rejected'?'مرفوض':r.status}</span>{r.status==='executed'&&<button onClick={()=>confirmRepReceipt(r.id)} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">تأكيد استلام التحويل</button>}</div>)}{!myRepTransfers.length&&<p className="text-sm text-slate-500">لا توجد طلبات بعد.</p>}</section>:<section className="rounded-2xl border bg-white p-4"><h2 className="mb-3 flex items-center gap-2 font-bold"><ClipboardList size={18}/> طلباتي</h2>{myCustomerOrders.map(o=><div key={o.id} className="mb-2 rounded-xl border p-3 text-sm"><b>{o.requestNumber}</b><p>{o.items.map(i=>`${i.productName} × ${i.quantity}`).join('، ')}</p><span className="text-blue-800">{o.status==='pending'?'بانتظار مراجعة الإدارة':o.status==='approved'?'تم قبول الطلب':o.status==='rejected'?`مرفوض: ${o.rejectionReason||''}`:'تم إنشاء الفاتورة'}</span></div>)}{!myCustomerOrders.length&&<p className="text-sm text-slate-500">لا توجد طلبات سابقة.</p>}</section>}
  </div></div>;
};
