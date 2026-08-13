#!/usr/bin/env bash

set -e

IPFS_TESTS=(
    "vitalik.eth"
    "blockranger.eth"
    "fast-ipfs.eth"
    "ur.integration-tests.eth"
)

IPNS_TESTS=(
    "kwenta.eth"
)

UNICODE_TESTS=(
    "xn--wu9haa.eth"
    "xn--wu9haa.eth.${DOMAIN_TLD}"
    "subs.xn--wu9haa.eth"
)

ARWEAVE_TESTS=(
    "makesy.eth"
)

ARNS_TESTS=(
    "0xcatchup.eth"
)

SWARM_TESTS=(
    "swarm.eth"
)

ART_TESTS=(
    "limo.art"
)

GNOSIS_TESTS=(
    "12345.gno"
)

# Basenames are resolved via the Basenames registry on Base L2. No known
# *.base.eth name currently has a contenthash on its registry-assigned
# resolver (existing records live on the superseded default L2Resolver and
# are not honored); add names here once they exist.
BASENAMES_TESTS=(
)

DOH_TESTS=(
    "cigtoken.eth"
    "weth.jsonapi.eth"
)

ASK_TESTS=(
    "esteroids.eth"
    "99re.eth.${DOMAIN_TLD}"
)

FAIL_ASK_TESTS=(
    "proofofhumanity.eth.com"
    "a.b.c.d.e.f.g.0xc0de4c0ffee.dev3.eth.${DOMAIN_TLD}"
    "2607:f8b0:4009:804::200e"
    "127.0.0.1"
)

BLACKLIST_TESTS=(
    "officnewdriver.eth"
)

IPFS_FLATTEN_TESTS=(
    "weth.jsonapi.eth"
)

NO_IPFS_FLATTEN_TESTS=(
    "vitalik.eth"
)

DATAURI_TESTS=(
    "singleparam.multiparam-weaken-home-truth-plan-9.eth"
)

DATAURL_TESTS=(
    "redirect-0x55559E7da7AeC04B3156e16a60Cf57A348843dFB.eth"
)

apitest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    status=$(curl http://127.0.0.1:8888 -H "Host: ${1}" -w %{http_code} -s -o /dev/null -H "X-Limo-Id: $(uuidgen)")
    if [[ "${status}" != "${2}" ]]; then
        printf "\nFAIL\n"
        exit 1
    else
        printf "\nPASS\n"
    fi
}

dohtest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    if curl http://127.0.0.1:11000/dns-query\?name="${1}"\&type=TXT -s -H "X-Limo-Id: $(uuidgen)" | jq '.Answer[0].data' | grep 'dnslink=/ipfs/b' >/dev/null; then
        printf "\nPASS\n"
    else
        printf "\nFAIL\n"
        exit 1
    fi
}

asktest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    status=$(curl http://127.0.0.1:9090/ask\?domain="${1}" -w %{http_code} -o /dev/null -s -H "X-Limo-Id: $(uuidgen)")
    if [[ "${status}" != "${2}" ]]; then
        printf "\nFAIL\n"
        exit 1
    else
        printf "\nPASS\n"
    fi
}

flattentest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    xcontent=$(curl http://127.0.0.1:8888 -H "Host: ${1}" -w '%header{X-Content-Location}' -s -o /dev/null -H "X-Limo-Id: $(uuidgen)")
    flatten=$(echo "${xcontent}" | cut -d'.' -f1)
    if [[ "${flatten}" != $(echo "${1}" | tr '.' '-') ]]; then
        printf "\nFAIL\n"
        exit 1
    else
        printf "\nPASS\n"
    fi
}

noflattentest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    if curl http://127.0.0.1:8888 -H "Host: ${1}" -w '%header{X-Content-Location}' -s -o /dev/null -H "X-Limo-Id: $(uuidgen)" | grep 'bafy' >/dev/null; then
        printf "\nPASS\n"
    else
        printf "\nFAIL\n"
        exit 1
    fi
}

daturitest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    datauri=$(curl http://127.0.0.1:8888 -H "Host: ${1}" -w '%header{X-Content-Path}' -s -o /dev/null -H "X-Limo-Id: $(uuidgen)")
    if [[ "${datauri}" == "/api/v1/dataurl/${1}/"* ]]; then
        printf "\nDATAURI LOCATION PASS\n"
        status=$(curl http://localhost:12500"${datauri}" -w %{http_code} -s -o /dev/null -H "X-Limo-Id: $(uuidgen)" || true)
        if [[ "${status}" != "${2}" ]]; then
            printf "\nDATURI FETCH FAIL\n"
            exit 1
        else
            printf "\nDATURI FETCH PASS\n"
        fi
    else
        printf "\nDATAURI LOCATION FAIL\n"
        exit 1
    fi
}

daturltest() {
    printf "\n%s\n" "${1}"
    printf "%s----------------\n" ""
    status=$(curl http://127.0.0.1:8888 -H "Host: ${1}" -w %{http_code} -s -o /dev/null -H "X-Limo-Id: $(uuidgen)")
    if [[ "${status}" == "${2}" ]]; then
        printf "\nDATAURL LOCATION PASS\n"
        dataurl=$(curl http://127.0.0.1:8888 -H "Host: ${1}" -w %{http_code} -L -s -o /dev/null -H "X-Limo-Id: $(uuidgen)")
        if [[ "${dataurl}" != "200" ]]; then
            printf "\nDATURL FOLLOW FAIL\n"
            exit 1
        else
            printf "\nDATURL FOLLOW PASS\n"
        fi
    else
        printf "\nDATAURL LOCATION FAIL\n"
        exit 1
    fi
}

# Run tests for non-datauri services
if [ "${ENABLE_DATAURI_TESTS}" != "true" ]; then
    # IPFS
    printf "\nRunning IPFS tests...\n"
    for test in "${IPFS_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # IPNS
    printf "\nRunning IPNS tests...\n"
    for test in "${IPNS_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Unicode
    printf "\nRunning Unicode tests...\n"
    for test in "${UNICODE_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Arweave
    printf "\nRunning Arweave tests...\n"
    for test in "${ARWEAVE_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # ARNS
    printf "\nRunning ARNS tests...\n"
    for test in "${ARNS_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Swarm
    printf "\nRunning Swarm tests...\n"
    for test in "${SWARM_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Art
    printf "\nRunning Art tests...\n"
    for test in "${ART_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Gnosis
    printf "\nRunning Gnosis tests...\n"
    for test in "${GNOSIS_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # Basenames
    printf "\nRunning Basenames tests...\n"
    for test in "${BASENAMES_TESTS[@]}"; do
        apitest "${test}" "200"
    done

    # DoH
    printf "\nRunning DoH tests...\n"
    for test in "${DOH_TESTS[@]}"; do
        dohtest "${test}" "200"
    done

    # Ask
    printf "\nRunning Ask tests...\n"
    for test in "${ASK_TESTS[@]}"; do
        asktest "${test}" "200"
    done

    # Fail Ask
    printf "\nRunning Ask tests that should fail...\n"
    for test in "${FAIL_ASK_TESTS[@]}"; do
        asktest "${test}" "422"
    done

    # Blacklist
    printf "\nRunning Blacklist tests...\n"
    for test in "${BLACKLIST_TESTS[@]}"; do
        apitest "${test}" "451"
    done

    # Flatten tests
    printf "\nRunning IPFS Flatten tests...\n"
    for test in "${IPFS_FLATTEN_TESTS[@]}"; do
        flattentest "${test}"
    done

    # DoH No-Flatten tests
    printf "\nRunning DoH IPFS no Flatten tests...\n"
    for test in "${IPFS_FLATTEN_TESTS[@]}"; do
        dohtest "${test}"
    done

    # No-Flatten tests for IPFS
    printf "\nRunning IPFS no Flatten tests...\n"
    for test in "${NO_IPFS_FLATTEN_TESTS[@]}"; do
        noflattentest "${test}"
    done
fi

# Only run DataURI and DataURL tests if ENABLE_DATAURI_TESTS is true
if [ "${ENABLE_DATAURI_TESTS}" = "true" ]; then
    shopt -s nocasematch
    # Data URI tests
    printf "\nRunning DataURI tests...\n"
    for test in "${DATAURI_TESTS[@]}"; do
        daturitest "${test}" "200"
    done

    # Data URL tests
    printf "\nRunning DataURL tests...\n"
    for test in "${DATAURL_TESTS[@]}"; do
        daturltest "${test}" "308"
    done
fi

