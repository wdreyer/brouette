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
  maxQuantity?: number | null;
  isSoldByWeight?: boolean;
  estimatedPriceMin?: number | null;
  estimatedPriceMax?: number | null;
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

export function replaceCart(items: CartItem[]) {
  writeCart(items);
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

function normalizeMaxQuantity(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function clampQuantity(quantity: number, maxQuantity?: number | null) {
  const minQuantity = Math.max(1, Math.floor(quantity));
  const max = normalizeMaxQuantity(maxQuantity);
  return max === null ? minQuantity : Math.min(minQuantity, max);
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
    const maxQuantity = normalizeMaxQuantity(item.maxQuantity ?? existing.maxQuantity);
    items[existingIndex] = {
      ...existing,
      offerItemId: item.offerItemId ?? existing.offerItemId,
      maxQuantity,
      quantity: clampQuantity(existing.quantity + item.quantity, maxQuantity),
    };
  } else {
    const maxQuantity = normalizeMaxQuantity(item.maxQuantity);
    items.push({
      ...item,
      maxQuantity,
      quantity: clampQuantity(item.quantity, maxQuantity),
    });
  }

  writeCart(items);
}

export function getCart(): CartItem[] {
  return readCart();
}

export function updateCartItem(id: string, quantity: number) {
  const items = readCart();
  const next = items.map((item) =>
    item.id === id ? { ...item, quantity: clampQuantity(quantity, item.maxQuantity) } : item,
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
