import { NextApiRequest, NextApiResponse } from "next";
import { Readable } from 'stream';
import Stripe from "stripe";
import { stripe } from '../../services/stripe';
import { saveSubscription } from "./_lib/manageSubscription";

async function buffer(readable: Readable) {
  const chunks = [];

  for await (const chunk of readable) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : chunk
    );
  }

  return Buffer.concat(chunks);
}

// desabilita o entendimento padrão do next como json para possibilitar o que está vindo na requisição tipo stream
// https://nextjs.org/docs/api-routes/api-middlewares Docs 
export const config = {
  api: {
    bodyParser: false
  }
};

const relevantEvents = new Set([
  'checkout.session.completed',  
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'POST') {
    const buf = await buffer(req);

    const secret = req.headers['stripe-signature'];

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(buf, secret, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    const { type } = event;

    if (relevantEvents.has(type)) {
      console.log('Evento recebido', event);      
      try {
        switch (type) {
          case 'checkout.session.completed':

            const checkoutSession = event.data.object as Stripe.Checkout.Session; 

            await saveSubscription(
              checkoutSession.subscription.toString(),
              checkoutSession.customer.toString(),
              true
            );

            break;          
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':

            const subscription = event.data.object as Stripe.Subscription;   

            await saveSubscription(
              subscription.id,
              subscription.customer.toString(),
              false
            );

            break;           
          default:
            throw new Error('Unhandled event.');
        }
      } catch (err) {
        // sentry, bugsnag para avisar ao dev que algum evento não está sendo encontrado
        return res.json({ error: 'Webhook handled failed!'});
      }
    } 

    res.json({ received: true });
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method not allowed');
  }
}