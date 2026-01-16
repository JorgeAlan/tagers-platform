-- ==================================================================
-- Migration 004: Payment Links Tracking
-- ==================================================================
-- Tracks the relationship between orders and conversations
-- so we can notify users when their payment is confirmed.
--
-- Run: psql $DATABASE_URL -f 004_payment_links.sql
-- ==================================================================

-- ==== PAYMENT LINKS TABLE ====
-- Stores the mapping of order_id to conversation_id for payment notification
CREATE TABLE IF NOT EXISTS payment_links (
  id BIGSERIAL PRIMARY KEY,
  
  -- Order identification
  order_id TEXT NOT NULL,
  woo_order_id TEXT NULL, -- WooCommerce order ID if different
  
  -- Conversation tracking
  conversation_id TEXT NOT NULL,
  contact_id TEXT NULL,
  account_id TEXT NULL,
  
  -- Payment provider details
  provider TEXT NOT NULL, -- 'mercadopago', 'stripe', 'cash'
  payment_id TEXT NULL, -- External payment ID from provider
  preference_id TEXT NULL, -- MercadoPago preference ID
  session_id TEXT NULL, -- Stripe session ID
  
  -- Payment details
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT DEFAULT 'MXN',
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', 
  -- pending, paid, failed, expired, refunded
  
  -- Notification tracking
  notification_sent BOOLEAN DEFAULT FALSE,
  notification_sent_at TIMESTAMPTZ NULL,
  notification_error TEXT NULL,
  
  -- Customer info (for backup notification)
  customer_phone TEXT NULL,
  customer_name TEXT NULL,
  customer_email TEXT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  paid_at TIMESTAMPTZ NULL,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_payment_links_order_id ON payment_links(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_conversation ON payment_links(conversation_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(status);
CREATE INDEX IF NOT EXISTS idx_payment_links_provider_payment ON payment_links(provider, payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_pending ON payment_links(status, created_at) WHERE status = 'pending';

-- Unique constraint on external payment IDs per provider
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_mp_preference 
  ON payment_links(preference_id) WHERE preference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_links_stripe_session 
  ON payment_links(session_id) WHERE session_id IS NOT NULL;

-- ==== HELPER FUNCTIONS ====

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_links_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS payment_links_update_timestamp ON payment_links;
CREATE TRIGGER payment_links_update_timestamp
  BEFORE UPDATE ON payment_links
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_links_timestamp();

-- ==== PROACTIVE OPT-OUT COLUMN ====
-- Add opt-out tracking to proactive_messages if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'proactive_messages') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'proactive_messages' AND column_name = 'opted_out') THEN
      ALTER TABLE proactive_messages ADD COLUMN opted_out BOOLEAN DEFAULT FALSE;
    END IF;
  END IF;
END $$;

-- ==== OPT-OUT TRACKING TABLE ====
CREATE TABLE IF NOT EXISTS proactive_optouts (
  id BIGSERIAL PRIMARY KEY,
  contact_id TEXT NOT NULL,
  conversation_id TEXT NULL,
  phone TEXT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NULL,
  UNIQUE(contact_id)
);

CREATE INDEX IF NOT EXISTS idx_proactive_optouts_phone ON proactive_optouts(phone);

-- ==== COMMENTS ====
COMMENT ON TABLE payment_links IS 'Tracks payment links and their associated conversations for automatic payment confirmation notifications';
COMMENT ON COLUMN payment_links.order_id IS 'Internal order ID used in the KISS API';
COMMENT ON COLUMN payment_links.woo_order_id IS 'WooCommerce order ID if order was created in WooCommerce';
COMMENT ON COLUMN payment_links.conversation_id IS 'Chatwoot conversation ID for sending notifications';
COMMENT ON COLUMN payment_links.status IS 'Payment status: pending, paid, failed, expired, refunded';
COMMENT ON TABLE proactive_optouts IS 'Tracks users who have opted out of proactive messages';
