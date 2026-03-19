export type CartItem = {
  id: string;
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  producerId: string;
  imageUrl?: string | null;
  saleDateKey?: string;
  saleDateLabel?: string;
  offerItemId?: string;
};

const CART_KEY = "brouette_cart";
const CART_EVENT = "cart:updated";
const GUEST_CART_KEY = `${CART_KEY}:guest`;
let currentCartKey = GUEST_CART_KEY;

function scopeCartKey(scopeId: string | null) {
  if (!scopeId) return GUEST_CART_KEY;
  return `${CART_KEY}:member:${encodeURIComponent(scopeId)}`;
}

function readCartFromKey(key: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

function readCart(): CartItem[] {
  return readCartFromKey(currentCartKey);
}

function writeCartToKey(key: string, items: CartItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

function writeCart(items: CartItem[]) {
  writeCartToKey(currentCartKey, items);
}

export function setCartUser(scopeId: string | null) {
  if (typeof window === "undefined") return;
  const nextKey = scopeCartKey(scopeId);
  if (nextKey === currentCartKey) {
    if (!scopeId) {
      writeCartToKey(GUEST_CART_KEY, []);
    }
    return;
  }

  currentCartKey = nextKey;
  if (!scopeId) {
    // No logged-in member: always reset anonymous cart for a clean session.
    writeCartToKey(GUEST_CART_KEY, []);
    return;
  }
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

export function addToCart(item: CartItem) {
  const items = readCart();
  const existingIndex = items.findIndex(
    (entry) =>
      entry.productId === item.productId &&
      entry.variantId === item.variantId &&
      entry.saleDateKey === item.saleDateKey,
  );

  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    items[existingIndex] = {
      ...existing,
      quantity: existing.quantity + item.quantity,
    };
  } else {
    items.push(item);
  }

  writeCart(items);
}

export function getCart(): CartItem[] {
  return readCart();
}

export function updateCartItem(id: string, quantity: number) {
  const items = readCart();
  const next = items.map((item) =>
    item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item,
  );
  writeCart(next);
}

export function removeFromCart(id: string) {
  const items = readCart().filter((item) => item.id !== id);
  writeCart(items);
}

export function clearCart() {
  writeCart([]);
}

export function subscribeCart(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(CART_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CART_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
