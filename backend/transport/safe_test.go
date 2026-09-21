package transport

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"
)

func TestIsBlockedAddr(t *testing.T) {
	tests := []struct {
		addr    string
		blocked bool
	}{
		// Blocked
		{"0.0.0.0", true},
		{"0.1.2.3", true},
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"172.31.255.255", true},
		{"192.168.1.1", true},
		{"100.64.0.1", true},
		{"169.254.169.254", true},
		{"192.0.0.1", true},
		{"192.0.2.1", true},
		{"198.18.0.1", true},
		{"198.51.100.1", true},
		{"203.0.113.1", true},
		{"224.0.0.1", true},
		{"240.0.0.1", true},
		{"255.255.255.255", true},
		{"::", true},
		{"::1", true},
		{"::ffff:127.0.0.1", true},
		{"::ffff:10.0.0.1", true},
		{"::ffff:169.254.169.254", true},
		{"64:ff9b::7f00:1", true},
		{"2001:db8::1", true},
		{"fe80::1", true},
		{"fec0::1", true},
		{"fc00::1", true},
		{"fd12:3456::1", true},
		{"ff02::1", true},
		{"ff01::1", true},
		// Allowed
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"93.184.216.34", false},
		{"2001:4860:4860::8888", false},
		{"2606:4700:4700::1111", false},
		{"::ffff:8.8.8.8", false},
	}

	for _, tc := range tests {
		t.Run(tc.addr, func(t *testing.T) {
			addr := netip.MustParseAddr(tc.addr)
			if got := isBlockedAddr(addr); got != tc.blocked {
				t.Errorf("isBlockedAddr(%s) = %v; want %v", tc.addr, got, tc.blocked)
			}
		})
	}

	if !isBlockedAddr(netip.Addr{}) {
		t.Error("zero-value (invalid) address should be blocked")
	}
}

// failingLookup fails the test if it is ever called.
func failingLookup(t *testing.T) LookupFunc {
	return func(_ context.Context, host string) ([]net.IPAddr, error) {
		t.Errorf("DNS lookup for %q should not have happened", host)
		return nil, errors.New("unexpected lookup")
	}
}

// staticLookup returns the same answer for every host.
func staticLookup(ips ...string) LookupFunc {
	return func(_ context.Context, _ string) ([]net.IPAddr, error) {
		out := make([]net.IPAddr, 0, len(ips))
		for _, ip := range ips {
			out = append(out, net.IPAddr{IP: net.ParseIP(ip)})
		}
		return out, nil
	}
}

func TestSafeDialer_RefusesNonWebPortBeforeLookup(t *testing.T) {
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, failingLookup(t))

	for _, addr := range []string{"8.8.8.8:8080", "example.com:22", "example.com:8443", "[2001:4860:4860::8888]:53"} {
		_, err := dial(context.Background(), "tcp", addr)
		if !errors.Is(err, ErrBlockedPort) {
			t.Errorf("dial(%s): got %v, want ErrBlockedPort", addr, err)
		}
	}
}

func TestSafeDialer_RefusesBlockedLiterals(t *testing.T) {
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, failingLookup(t))

	for _, addr := range []string{"127.0.0.1:80", "192.168.1.1:80", "169.254.169.254:80", "[::1]:443", "[::ffff:127.0.0.1]:80", "0.0.0.0:80"} {
		_, err := dial(context.Background(), "tcp", addr)
		if !errors.Is(err, ErrBlockedAddress) {
			t.Errorf("dial(%s): got %v, want ErrBlockedAddress", addr, err)
		}
	}
}

func TestSafeDialer_RefusesPrivateDNSAnswer(t *testing.T) {
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, staticLookup("10.0.0.1"))

	_, err := dial(context.Background(), "tcp", "evil.example:80")
	if !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("got %v, want ErrBlockedAddress", err)
	}
}

func TestSafeDialer_RefusesMixedDNSAnswer(t *testing.T) {
	// A public address first and a private one second: the whole dial must be
	// refused, not retried against the public address.
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, staticLookup("8.8.8.8", "10.0.0.1"))

	_, err := dial(context.Background(), "tcp", "evil.example:443")
	if !errors.Is(err, ErrBlockedAddress) {
		t.Errorf("got %v, want ErrBlockedAddress", err)
	}
}

func TestSafeDialer_EmptyDNSAnswer(t *testing.T) {
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, staticLookup())

	_, err := dial(context.Background(), "tcp", "nowhere.example:80")
	if !errors.Is(err, ErrNoAddresses) {
		t.Errorf("got %v, want ErrNoAddresses", err)
	}
}

func TestSafeDialer_DNSErrorPropagates(t *testing.T) {
	want := errors.New("nxdomain")
	dial := SafeDialer(&net.Dialer{Timeout: 50 * time.Millisecond}, func(context.Context, string) ([]net.IPAddr, error) {
		return nil, want
	})

	_, err := dial(context.Background(), "tcp", "nowhere.example:80")
	if !errors.Is(err, want) {
		t.Errorf("got %v, want %v", err, want)
	}
}

func TestSafeDialer_AllowLocalIPsBypass(t *testing.T) {
	SetAllowLocalIPs(true)
	t.Cleanup(func() { SetAllowLocalIPs(false) })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()

	dial := SafeDialer(&net.Dialer{Timeout: time.Second}, failingLookup(t))
	conn, err := dial(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("expected dial to succeed with AllowLocalIPs, got %v", err)
	}
	_ = conn.Close()
}

func TestSafeDialer_DialsValidatedAddress(t *testing.T) {
	// With the bypass on, a host name that "resolves" to the listener's address
	// must be dialed at that address, proving the dial uses the validated IP
	// rather than re-resolving the host name.
	SetAllowLocalIPs(true)
	t.Cleanup(func() { SetAllowLocalIPs(false) })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()
	_, port, _ := net.SplitHostPort(ln.Addr().String())

	dial := SafeDialer(&net.Dialer{Timeout: time.Second}, staticLookup("127.0.0.1"))
	conn, err := dial(context.Background(), "tcp", "does-not-exist.invalid:"+port)
	if err != nil {
		t.Fatalf("expected dial to succeed, got %v", err)
	}
	_ = conn.Close()
}
