import { loadStripe } from '@stripe/stripe-js/pure'

const request = mppx.challenge.request as Record<string, any>

const stripe = (await loadStripe(mppx.config.publishableKey as string))!
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const elements = stripe.elements({
  mode: 'payment',
  amount: Number(request.amount),
  currency: request.currency as string,
  appearance: { theme: isDark ? 'night' : 'stripe', variables: { spacingUnit: '3px' } },
  paymentMethodTypes: ['card'],
  paymentMethodCreation: 'manual',
})
elements
  .create('payment', {
    layout: 'tabs',
    fields: { billingDetails: { address: { postalCode: 'never', country: 'never' } } },
    wallets: { link: 'never' },
  })
  .mount('#payment-element')

const payBtn = document.getElementById('pay') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLOutputElement

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  elements.update({ appearance: { theme: e.matches ? 'night' : 'stripe' } })
})

payBtn.onclick = async () => {
  payBtn.disabled = true
  const submitResult = await elements.submit()
  if (submitResult.error) {
    statusEl.textContent = submitResult.error.message!
    statusEl.style.color = 'red'
    payBtn.disabled = false
    return
  }
  const result = await stripe.createPaymentMethod({
    elements,
    params: { billing_details: { address: { postal_code: '10001', country: 'US' } } },
  })
  if (result.error) {
    statusEl.textContent = result.error.message!
    statusEl.style.color = 'red'
    payBtn.disabled = false
    return
  }

  const res = await fetch('/api/create-spt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethod: result.paymentMethod.id,
      amount: String(request.amount),
      currency: request.currency as string,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    statusEl.textContent = err.error || 'SPT creation failed'
    statusEl.style.color = 'red'
    payBtn.disabled = false
    return
  }
  const data = await res.json()
  dispatchEvent(
    new CustomEvent('mppx:complete', {
      detail: mppx.serializeCredential({ spt: data.spt }),
    }),
  )
}
