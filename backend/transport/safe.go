// Package transport provides an http.Transport hardened against SSRF: every
// outbound connection is resolved first and refused unless all resolved
// addresses are publicly routable and the port is 80 or 443.
package transport

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"sync/atomic"
	"time"
)

var (
	// ErrBlockedAddress is returned when a destination resolves to an address
	// that is not publicly routable (loopback, private, link-local, ...).
	ErrBlockedAddress = errors.New("blocked: destination is not a public address")

	// ErrBlockedPort is returned when a destination port is not 80 or 443.
	ErrBlockedPort = errors.New("blocked: destination port is not 80 or 443")

	// ErrNoAddresses is returned when DNS resolution yields no addresses.
	ErrNoAddresses = errors.New("no IP addresses found")
)

// LookupFunc resolves a host name to IP addresses. net.Resolver.LookupIPAddr
// satisfies it.
type LookupFunc func(ctx context.Context, host string) ([]net.IPAddr, error)

// allowLocalIPs disables the address and port checks. It exists only so tests
// can talk to httptest servers on 127.0.0.1; production never sets it.
var allowLocalIPs atomic.Bool

// SetAllowLocalIPs enables or disables the SSRF checks. Tests only.
func SetAllowLocalIPs(v bool) { allowLocalIPs.Store(v) }

// AllowLocalIPs reports whether the SSRF checks are currently disabled.
func AllowLocalIPs() bool { return allowLocalIPs.Load() }

// extraBlocked lists ranges that netip's own classifiers do not cover (or that
// we want blocked regardless of how the classifiers evolve).
var extraBlocked = mustPrefixes(
	"0.0.0.0/8",       // "this" network
	"100.64.0.0/10",   // carrier-grade NAT (RFC 6598)
	"192.0.0.0/24",    // IETF protocol assignments
	"192.0.2.0/24",    // TEST-NET-1
	"198.18.0.0/15",   // benchmarking (RFC 2544)
	"198.51.100.0/24", // TEST-NET-2
	"203.0.113.0/24",  // TEST-NET-3
	"224.0.0.0/4",     // multicast
	"240.0.0.0/4",     // reserved, includes 255.255.255.255
	"64:ff9b::/96",    // NAT64 (maps to IPv4 space)
	"2001:db8::/32",   // documentation
	"fec0::/10",       // deprecated site-local
	"ff00::/8",        // multicast
	"::/128",          // unspecified
)

func mustPrefixes(cidrs ...string) []netip.Prefix {
	out := make([]netip.Prefix, 0, len(cidrs))
	for _, c := range cidrs {
		out = append(out, netip.MustParsePrefix(c))
	}
	return out
}

// isBlockedAddr reports whether addr must never be dialed. IPv4-mapped IPv6
// addresses are unmapped first so that ::ffff:127.0.0.1 is treated as 127.0.0.1.
func isBlockedAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() ||
		addr.IsUnspecified() ||
		addr.IsLoopback() ||
		addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsMulticast() ||
		addr.IsInterfaceLocalMulticast() {
		return true
	}
	for _, p := range extraBlocked {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func isAllowedPort(port string) bool {
	return port == "80" || port == "443"
}

// SafeDialer returns a DialContext function that refuses non-web ports before
// any DNS lookup, resolves the host with lookup, and refuses the whole dial if
// any resolved address is blocked (a mixed public/private answer is a DNS
// rebinding trick, not something to retry). The connection is then made to
// the validated address, never to the host name, so a second lookup cannot
// change the destination.
func SafeDialer(dialer *net.Dialer, lookup LookupFunc) func(ctx context.Context, network, addr string) (net.Conn, error) {
	if lookup == nil {
		lookup = net.DefaultResolver.LookupIPAddr
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}

		bypass := allowLocalIPs.Load()
		if !bypass && !isAllowedPort(port) {
			return nil, ErrBlockedPort
		}

		addrs, err := resolve(ctx, host, lookup)
		if err != nil {
			return nil, err
		}
		if len(addrs) == 0 {
			return nil, ErrNoAddresses
		}
		if !bypass {
			for _, a := range addrs {
				if isBlockedAddr(a) {
					return nil, ErrBlockedAddress
				}
			}
		}

		var lastErr error
		for _, a := range addrs {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(a.Unmap().String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
			if ctx.Err() != nil {
				break
			}
		}
		return nil, lastErr
	}
}

// resolve returns the candidate addresses for host: the literal itself if host
// is an IP literal, otherwise the DNS answer.
func resolve(ctx context.Context, host string, lookup LookupFunc) ([]netip.Addr, error) {
	if a, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{a}, nil
	}
	ipAddrs, err := lookup(ctx, host)
	if err != nil {
		return nil, err
	}
	out := make([]netip.Addr, 0, len(ipAddrs))
	for _, ia := range ipAddrs {
		a, ok := netip.AddrFromSlice(ia.IP)
		if !ok {
			// An unparseable answer is treated as hostile rather than skipped.
			return nil, ErrBlockedAddress
		}
		if ia.Zone != "" {
			a = a.WithZone(ia.Zone)
		}
		out = append(out, a)
	}
	return out, nil
}

// NewSafeTransport returns an http.Transport whose connections go through
// SafeDialer with the system resolver.
func NewSafeTransport() *http.Transport {
	dialer := &net.Dialer{
		Timeout:   2 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	return &http.Transport{
		DialContext:           SafeDialer(dialer, net.DefaultResolver.LookupIPAddr),
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}
