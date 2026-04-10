import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { InvoiceRecord } from '../../types/invoice'

let fontRegistered = false

export function registerInvoicePdfFont(): void {
  if (typeof window === 'undefined' || fontRegistered) return
  Font.register({
    family: 'NotoSans',
    src: `${window.location.origin}/fonts/NotoSans-Regular.ttf`,
  })
  fontRegistered = true
}

function moneyFmt(amount: number, currency: InvoiceRecord['currency']): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

function sourceLabel(t: InvoiceRecord['source_type']): string {
  if (t === 'ksef') return 'KSeF'
  if (t === 'email') return 'E-mail'
  return 'Inne'
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'NotoSans',
    fontSize: 9,
    color: '#1a1f2e',
    lineHeight: 1.35,
  },
  header: {
    backgroundColor: '#1e3a5f',
    color: '#f1f5f9',
    padding: 14,
    marginBottom: 18,
    borderRadius: 2,
  },
  headerKicker: { fontSize: 8, opacity: 0.85, marginBottom: 6 },
  headerTitle: { fontSize: 16, marginBottom: 4 },
  headerSub: { fontSize: 10, opacity: 0.92 },
  row2: { flexDirection: 'row', marginBottom: 16 },
  col: { flex: 1, paddingRight: 14 },
  label: {
    fontSize: 7,
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  value: { fontSize: 10 },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 14 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, paddingRight: 4 },
  kvLeft: { fontSize: 9, color: '#475569', flex: 1 },
  kvRight: { fontSize: 9, textAlign: 'right', maxWidth: '55%' },
  totalsBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderLeftWidth: 3,
    borderLeftColor: '#2563eb',
  },
  totalNet: { fontSize: 10, marginBottom: 4 },
  totalGross: { fontSize: 13, marginTop: 4 },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
})

export function InvoicePdfDocument({ invoice }: { invoice: InvoiceRecord }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerKicker}>FV Control · dokument księgowy</Text>
          <Text style={styles.headerTitle}>Faktura</Text>
          <Text style={styles.headerSub}>Numer: {invoice.invoice_number}</Text>
        </View>

        <View style={styles.row2}>
          <View style={styles.col}>
            <Text style={styles.label}>Sprzedawca</Text>
            <Text style={styles.value}>{invoice.supplier_name}</Text>
            <Text style={[styles.value, { marginTop: 6 }]}>NIP: {invoice.supplier_nip}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Nabywca (lokal)</Text>
            <Text style={styles.value}>{invoice.restaurant_name}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Data wystawienia</Text>
          <Text style={styles.kvRight}>{invoice.issue_date}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Termin płatności</Text>
          <Text style={styles.kvRight}>{invoice.due_date}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Źródło</Text>
          <Text style={styles.kvRight}>
            {sourceLabel(invoice.source_type)} · {invoice.source_account}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Numer KSeF</Text>
          <Text style={styles.kvRight}>{invoice.ksef_number ?? '—'}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Kategoria</Text>
          <Text style={styles.kvRight}>{invoice.category ?? '—'}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLeft}>Waluta</Text>
          <Text style={styles.kvRight}>{invoice.currency}</Text>
        </View>

        <View style={styles.totalsBox}>
          <Text style={styles.totalNet}>Netto: {moneyFmt(invoice.net_amount, invoice.currency)}</Text>
          <Text style={styles.totalGross}>Brutto: {moneyFmt(invoice.gross_amount, invoice.currency)}</Text>
        </View>

        <Text style={styles.footer} fixed>
          Wygenerowano w FV Control — podgląd na podstawie danych z systemu (OCR / KSeF / import). Nie zastępuje
          oryginału elektronicznego, o ile został dostarczony.
        </Text>
      </Page>
    </Document>
  )
}
